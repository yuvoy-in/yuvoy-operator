import { http, HttpResponse } from "msw";
import {
  CHECK_IN_CODES,
  mockCheckInRefusal,
  mockNormaliseCode,
} from "./check-in-codes";
import type { MockParty } from "./fixtures";

/**
 * The check-in and cash routes of the mock API: checking a traveller in by
 * their code, and taking the cash at the gangway. Moved out of `handlers.ts`
 * as they were (yuvoy-operator#178). The helpers and the state stay there.
 * The attendance and the cash taken come in through getters in `deps`,
 * because `__resetOperatorMocks` replaces them.
 */
export interface CheckInMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  partyOf: (bookingId: string) => { slotId: string; party: MockParty } | null;
  bookingStateOf: (p: MockParty) => string;
  /** What happened to each booking on the day, by booking id. */
  attendance: () => Record<string, { outcome: string; arrivedAt?: string }>;
  /** The cash each booking handed over, by booking id. */
  cashTaken: () => Record<
    string,
    { collectedPaise: number; collectedAt: string }
  >;
}

export function checkInHandlers(deps: CheckInMockDeps) {
  const {
    url,
    requireSession,
    envelope,
    partyOf,
    bookingStateOf,
    attendance,
    cashTaken,
  } = deps;

  return [
    /* -------------------------------------------------------- check-ins - */

    /*
      Check-in by code, yuvoy-operator#175, in the API's words
      (host_check_in.go at a53d7b3a): a code that is not one of ours is 404, a
      reference from the QR that is not the code's booking is 409, and a second
      scan answers 200 with the first time and `alreadyCheckedIn`.
    */
    http.post(url("/check-ins"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const body = (await request.json()) as {
        code?: unknown;
        reference?: unknown;
      };
      const code =
        typeof body.code === "string" ? mockNormaliseCode(body.code) : "";
      if (code.length !== 8) {
        return envelope(
          "invalid_input",
          "we could not read that check-in",
          400,
          {
            code: "the eight characters the traveller shows, like K7QM-2XPA",
          },
        );
      }

      const refused = mockCheckInRefusal(code);
      if (refused) {
        return envelope(
          refused.code,
          refused.message,
          refused.status,
          refused.details,
        );
      }

      const bookingId = CHECK_IN_CODES[code];
      const found = bookingId ? partyOf(bookingId) : null;
      if (!bookingId || !found) {
        return envelope(
          "not_found",
          "This code is not for one of your bookings.",
          404,
        );
      }
      const { party, slotId } = found;
      if (body.reference !== undefined && body.reference !== party.reference) {
        return envelope(
          "check_in_code_mismatch",
          `This code does not match booking ${String(body.reference)}. Check them in by name if it is them.`,
          409,
        );
      }

      const existing = attendance()[bookingId];
      if (existing && existing.outcome !== "arrived") {
        return envelope(
          "not_on_this_departure",
          // The store's own error, which the API sends as it is.
          "this booking is not on the departure",
          409,
        );
      }
      const before =
        existing?.arrivedAt ?? (party.arrived ? party.arrivedAt : undefined);
      const arrivedAt = before ?? new Date().toISOString();
      attendance()[bookingId] = { outcome: "arrived", arrivedAt };
      return HttpResponse.json({
        bookingId,
        reference: party.reference,
        name: party.name,
        guests: party.guests,
        slotId,
        arrivedAt,
        alreadyCheckedIn: before !== undefined,
      });
    }),

    /* -------------------------------------------------------------- cash -- */

    /**
     * Taking the cash — yuvoy-operator#40 §1.
     *
     * The API's own rules, in the API's own order (`RecordCashCollected`):
     *
     *   1. not a cash booking → 409, "already paid online";
     *   2. already recorded → the FIRST report, `alreadyRecorded: true`, the
     *      amount never overwritten — checked before the state, so a retry on a
     *      booking that has since been completed still gets its answer;
     *   3. a booking that can no longer take money → 409;
     *   4. more than the fare → 409, refused rather than trimmed.
     *
     * Not role-gated: "whoever is holding the phone at the gangway is who takes
     * the cash." The messages are production's, lower case and all, because the
     * screen renders them.
     */
    http.post(
      url("/bookings/:id/cash-collected"),
      async ({ request, params }) => {
        const failed = requireSession(request);
        if (failed) return failed;

        const id = String(params.id);
        const found = partyOf(id);
        if (!found)
          return envelope("not_found", "we could not find that booking", 404);

        const { party } = found;
        if (!party.cash) {
          return envelope(
            "conflict",
            "this booking was already paid online — there is nothing to collect",
            409,
          );
        }

        const fare = party.cash.collectPaise;
        const first =
          cashTaken()[id] ??
          (party.cash.collected && party.cash.collectedAt
            ? {
                collectedPaise: party.cash.collectedPaise ?? fare,
                collectedAt: party.cash.collectedAt,
              }
            : undefined);
        if (first) {
          return HttpResponse.json({
            collectedPaise: first.collectedPaise,
            shortfallPaise: fare - first.collectedPaise,
            collectedAt: first.collectedAt,
            state: bookingStateOf(party),
            alreadyRecorded: true,
          });
        }

        const state = bookingStateOf(party);
        if (state !== "paid_pending_ops" && state !== "confirmed") {
          return envelope(
            "conflict",
            `this booking is not on the departure: it is ${state}`,
            409,
          );
        }

        const body = (await request.json().catch(() => ({}))) as {
          collectedPaise?: unknown;
        };
        let amount = fare;
        if (body.collectedPaise !== undefined) {
          if (
            typeof body.collectedPaise !== "number" ||
            !Number.isInteger(body.collectedPaise) ||
            body.collectedPaise < 0
          ) {
            return envelope("invalid_input", "that is not an amount", 400);
          }
          amount = body.collectedPaise;
        }
        if (amount > fare) {
          return envelope(
            "conflict",
            "that is more than the fare for this booking",
            409,
          );
        }

        const collectedAt = new Date().toISOString();
        cashTaken()[id] = { collectedPaise: amount, collectedAt };
        return HttpResponse.json({
          collectedPaise: amount,
          shortfallPaise: fare - amount,
          collectedAt,
          state: "confirmed",
          alreadyRecorded: false,
        });
      },
    ),
  ];
}
