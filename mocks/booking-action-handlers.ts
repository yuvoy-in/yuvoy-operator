import { http, HttpResponse } from "msw";
import { deadlineLabel } from "../src/lib/format/market-time";
import { REQUESTS, SLOTS, type MockParty, type MockSlot } from "./fixtures";

/**
 * The booking action routes of the mock API: cancelling a booking, recording
 * cash given back, one booking, and the seat requests. Moved out of
 * `handlers.ts` as they were (yuvoy-operator#178). The helpers and the state
 * stay there. The state comes in through getters in `deps`, because
 * `__resetOperatorMocks` replaces it.
 */
export interface BookingActionMockDeps {
  url: (path: string) => string;
  requireManager: (request: Request, refusal: string) => Response | null;
  requireSession: (request: Request) => Response | null;
  requireWritable: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  isNewBusiness: (request: Request) => boolean;
  bookingMoney: (p: MockParty) => {
    grossPaise: number;
    commissionPaise: number;
    refundsPaise: number;
    netPaise: number;
  };
  bookingStateOf: (p: MockParty) => string;
  bookingCashOf: (p: MockParty) =>
    | {
        collectPaise: number;
        collected: boolean;
        collectedAt: string;
        collectedPaise: number;
      }
    | NonNullable<MockParty["cash"]>
    | undefined;
  bookingCancellationOf: (p: MockParty) =>
    | {
        at: string;
        by: string;
        reasonCode: string;
        operatorCancelled: { reasonCode: string };
      }
    | MockParty["cancellation"];
  cashReturnOf: (p: MockParty) => {
    returnedAt?: string;
    returnedPaise?: number;
  };
  /** Bookings cancelled this session, by id. */
  cancelled: () => Record<
    string,
    { at: string; reasonCode: string; refundedPaise: number }
  >;
  /** Cash handed back, by booking id. */
  cashReturned: () => Record<
    string,
    { returnedAt: string; returnedPaise: number }
  >;
  /** Cash recorded taken, by booking id. */
  cashTaken: () => Record<
    string,
    { collectedPaise: number; collectedAt: string }
  >;
  /** The seat requests answered this session, by id. */
  answered: () => Record<string, "active" | "released">;
}

export function bookingActionHandlers(deps: BookingActionMockDeps) {
  const {
    url,
    requireManager,
    requireSession,
    requireWritable,
    envelope,
    isNewBusiness,
    bookingMoney,
    bookingStateOf,
    bookingCashOf,
    bookingCancellationOf,
    cashReturnOf,
    cancelled,
    cashReturned,
    cashTaken,
    answered,
  } = deps;

  return [
    /*
      Cancelling ONE booking — yuvoy-operator#43 item 4.

      Every refusal is modelled, because each one is a different sentence on the
      screen and none of them would ever render against a permissive mock: the
      reference typed back, the role, the departure that has left, the booking
      that already ended, and the retry that must not refund twice.
    */
    http.post(url("/bookings/:id/cancel"), async ({ request, params }) => {
      const failed = requireManager(request, "STAFF cannot cancel a booking.");
      if (failed) return failed;
      /*
        NOT `requireWritable`. A suspended business must still be able to tell a
        traveller their trip is off (#50), and refusing here would strand the
        traveller rather than the operator.
      */

      const id = String(params.id);
      let found: { party: MockParty; slot: MockSlot } | null = null;
      for (const slot of SLOTS) {
        const party = slot.parties.find((p) => p.bookingId === id);
        if (party) found = { party, slot };
      }
      // "Another business's booking answers `404` BEFORE its reference is
      // compared" — so a wrong id can never be used to learn a reference.
      if (!found) return envelope("not_found", "No such booking.", 404);

      const body = (await request.json()) as {
        reasonCode?: string;
        note?: string;
        confirmReference?: string;
      };

      if (
        ![
          "weather",
          "equipment",
          "staffing",
          "safety",
          "insufficient_numbers",
        ].includes(body.reasonCode ?? "")
      ) {
        return envelope(
          "invalid_reason_code",
          "Pick a reason from the list.",
          400,
        );
      }
      if ((body.note ?? "").length > 500) {
        return envelope(
          "invalid_input",
          "That note is longer than 500 characters.",
          400,
        );
      }

      /*
        "Letter case and surrounding spaces are ignored." Modelled, because the
        alternative is a portal that uppercases on the client to be safe and a
        real API that did not need it.
      */
      const typed = (body.confirmReference ?? "").trim().toUpperCase();
      if (typed !== found.party.reference.toUpperCase()) {
        return envelope(
          "confirmation_required",
          "That is not this booking's reference.",
          400,
        );
      }

      if (cancelled()[id]) {
        return envelope(
          "already_cancelled",
          "This booking is already cancelled.",
          409,
        );
      }

      const state = bookingStateOf(found.party);
      if (state !== "confirmed" && state !== "paid_pending_ops") {
        return envelope(
          "booking_ended",
          "This booking was declined, completed or marked a no-show.",
          409,
        );
      }
      if (Date.parse(found.slot.startsAt) <= Date.now()) {
        return envelope("departure_started", "That departure has left.", 409);
      }

      /*
        A cash booking captured nothing online, so nothing is refunded and the
        response says the money is with the business. That sentence is the only
        thing standing between an operator and a traveller who was never handed
        their cash back.
      */
      const money = bookingMoney(found.party);
      const refundedPaise = found.party.cash ? 0 : (money?.grossPaise ?? 0);
      const held = cashTaken()[id];

      cancelled()[id] = {
        at: new Date().toISOString(),
        reasonCode: body.reasonCode!,
        refundedPaise,
      };

      return HttpResponse.json({
        bookingId: id,
        reference: found.party.reference,
        state: "cancelled",
        reasonCode: body.reasonCode,
        refundedPaise,
        seatsReleased: found.party.guests,
        ...(held
          ? {
              cashToGiveBackPaise: held.collectedPaise,
              note: "You have this traveller's cash. Give it back to them, then record it here.",
            }
          : {}),
      });
    }),

    http.post(
      url("/bookings/:id/cash-returned"),
      async ({ request, params }) => {
        const failed = requireManager(
          request,
          "STAFF cannot record giving the cash back.",
        );
        if (failed) return failed;

        const id = String(params.id);
        let party: MockParty | null = null;
        for (const slot of SLOTS) {
          const hit = slot.parties.find((p) => p.bookingId === id);
          if (hit) party = hit;
        }
        if (!party) return envelope("not_found", "No such booking.", 404);

        if (cashReturned()[id]) {
          /*
            "A retry answers `409 cash_already_returned` and changes nothing." The
            common way to arrive here is a second tap on one bar of signal, and a
            mock that recorded twice would let the portal ship a screen that says a
            traveller was handed money twice.
          */
          return envelope(
            "cash_already_returned",
            "You already recorded giving this cash back.",
            409,
          );
        }

        /*
          Read through the same two functions `GET /bookings/{id}` reads through,
          not from the portal's own write log.

          This checked `cancelled[id]` and `cashTaken[id]` at first, which only know
          about what happened through the portal in this process. A booking that
          arrives already cancelled with its cash already taken — the fixture for a
          called-off departure, and the only shape this endpoint exists for — was
          therefore answered "this booking is not cancelled".
        */
        const effectiveCash = bookingCashOf(party);
        const takenPaise = effectiveCash?.collected
          ? (effectiveCash.collectedPaise ?? effectiveCash.collectPaise)
          : undefined;

        if (
          bookingStateOf(party) !== "cancelled" ||
          !party.cash ||
          takenPaise === undefined
        ) {
          // Three cases, one code, and "the message says which".
          return envelope(
            "nothing_to_give_back",
            !party.cash
              ? "This booking was paid online, so there is nothing of yours to give back."
              : bookingStateOf(party) !== "cancelled"
                ? "This booking is not cancelled."
                : "No cash is recorded as taken on this booking.",
            409,
          );
        }

        const record = {
          returnedAt: new Date().toISOString(),
          returnedPaise: takenPaise,
        };
        cashReturned()[id] = record;
        return HttpResponse.json({
          bookingId: id,
          reference: party.reference,
          ...record,
        });
      },
    ),

    http.get(url("/bookings/:id"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const id = String(params.id);

      for (const slot of SLOTS) {
        const party = slot.parties.find((p) => p.bookingId === id);
        if (party) {
          return HttpResponse.json({
            id: party.bookingId,
            reference: party.reference,
            state: bookingStateOf(party),
            guests: party.guests,
            experience: slot.title,
            experienceId: slot.experienceId,
            /*
              The departure itself, which the booking screen links to
              (yuvoy-api#259). Before it, the portal found the departure by the
              listing's id and the start time; `departure-of.ts` still does on
              an API that sends none.
            */
            slotId: slot.id,
            slot: { startsAt: slot.startsAt, timezone: slot.timezone },
            contact: { name: party.name },
            createdAt: new Date(
              new Date(slot.startsAt).getTime() - 3 * 86_400_000,
            ).toISOString(),
            money: bookingMoney(party),
            ...(party.cash
              ? {
                  cash: { ...bookingCashOf(party), ...cashReturnOf(party) },
                }
              : {}),
            ...(bookingCancellationOf(party)
              ? { cancellation: bookingCancellationOf(party) }
              : {}),
            ...(party.screening ? { screening: party.screening } : {}),
            ...(party.questions ? { questions: party.questions } : {}),
          });
        }
      }

      const req = REQUESTS.find((r) => r.id === id);
      if (req) {
        return HttpResponse.json({
          id: req.id,
          state: "pending_request",
          guests: req.guests,
          experience: req.experience,
          experienceId: req.experienceId,
          slotId: req.slotId,
          slot: { startsAt: req.startsAt, timezone: req.timezone },
          contact: { name: req.contactName },
          createdAt: req.requestedAt,
        });
      }

      return HttpResponse.json(
        { error: { code: "not_found", message: "no such booking" } },
        { status: 404 },
      );
    }),

    /* ------------------------------------------------------------ requests - */

    http.get(url("/requests"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      if (isNewBusiness(request)) return HttpResponse.json({ requests: [] });

      // Answered requests leave the queue. Ordered soonest-to-expire, which is
      // the endpoint's own order and the whole shape of the screen.
      return HttpResponse.json({
        requests: REQUESTS.filter((r) => !answered()[r.id]).sort(
          (a, b) => a.minutesToAnswer - b.minutesToAnswer,
        ),
      });
    }),

    http.post(url("/requests/:id/accept"), async ({ request, params }) => {
      const failed = requireManager(request, "STAFF cannot commit seats.");
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;

      const id = String(params.id);
      const open = REQUESTS.find((r) => r.id === id);
      if (!open) return envelope("not_found", "No such request.", 404);

      // Already answered, or out of time. One code for both, as the contract has
      // it — the operator's next move is the same either way: look again.
      if (answered()[id]) {
        return envelope("request_not_open", "Already answered.", 409);
      }

      /*
        The ceiling is enforced here rather than assumed. A mock that grants
        anything lets a client ship without the disabled state, and the first
        time an operator meets it is on a dock with a full boat.
      */
      if (open.guests > open.seatsGrantable) {
        return envelope(
          "grant_ceiling_exceeded",
          "That would put more people on the departure than it holds.",
          409,
        );
      }

      answered()[id] = "active";
      /*
        The traveller now holds seats with a clock on them and must pay: twelve
        hours, capped at the departure's booking cutoff (yuvoy-api#203), which an
        hour before it leaves stands in for here. Never less than ten minutes, so
        a run late at night still gets a hold in the future.
      */
      const cutoff = Date.parse(open.startsAt) - 60 * 60_000;
      const holdExpiresAt = new Date(
        Math.max(
          Math.min(Date.now() + 12 * 60 * 60_000, cutoff),
          Date.now() + 10 * 60_000,
        ),
      ).toISOString();
      /*
        `toldBy` and `receipt`, as the API writes them: queued by email because
        there is no WhatsApp sender, and the whole sentence with the pay-by time
        in market time, the day included when it is not today.
      */
      const told = ["email"];
      const seats = `${open.guests} ${open.guests === 1 ? "seat" : "seats"}`;
      return HttpResponse.json({
        id,
        state: "active",
        holdExpiresAt,
        toldBy: told,
        receipt: `They are holding ${seats} and still have to pay. We are letting them know by email. If they have not paid by ${deadlineLabel(holdExpiresAt, open.timezone, Date.now())}, the seats come back to you.`,
      });
    }),

    http.post(url("/requests/:id/decline"), async ({ request, params }) => {
      const failed = requireManager(request, "STAFF cannot answer requests.");
      if (failed) return failed;

      const id = String(params.id);
      if (!REQUESTS.some((r) => r.id === id)) {
        return envelope("not_found", "No such request.", 404);
      }
      if (answered()[id]) {
        return envelope("request_not_open", "Already answered.", 409);
      }

      const { reasonCode } = (await request.json()) as { reasonCode?: string };
      if (!reasonCode) {
        return envelope("bad_request", "reasonCode is required.", 400);
      }

      answered()[id] = "released";
      return HttpResponse.json({ id, state: "released", holdExpiresAt: null });
    }),
  ];
}
