import { http, HttpResponse } from "msw";
import { SLOTS, type MockParty, type MockSlot } from "./fixtures";

/**
 * The departure routes of the mock API: counter sales and taking one back,
 * both relays, calling a departure off and attendance. Moved out of
 * `handlers.ts` as they were (yuvoy-operator#178). The helpers and the state
 * stay there. The state comes in through getters in `deps`, because
 * `__resetOperatorMocks` replaces it.
 */
export interface DepartureMockDeps {
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
  allSlots: () => MockSlot[];
  departureSeats: (slot: MockSlot) => {
    seats: number;
    sold: number;
    remaining: number;
    soldOffline: number;
  };
  partyOf: (bookingId: string) => { slotId: string; party: MockParty } | null;
  bookingStateOf: (p: MockParty) => string;
  cashToGiveBackOf: (slot: MockSlot) => {
    totalPaise: number;
    parties: {
      bookingId: string;
      reference: string;
      name: string;
      guests: number;
      amountPaise: number;
    }[];
    note: string;
  } | null;
  arrivalTime: (slot: MockSlot, seenAt: number | undefined) => string;
  relay: (
    request: Request,
    audienceOf: () => MockParty[] | null,
  ) => Promise<Response>;
  RFC3339: RegExp;
  /** The seats set on each departure, by id. */
  capacity: () => Record<string, number>;
  /** The seats sold at the counter this session, by departure id. */
  offlineSold: () => Record<string, number>;
  /** Each counter sale, so one can be taken back. */
  offlineEntries: () => {
    id: string;
    slotId: string;
    seats: number;
    takenBack: boolean;
  }[];
  /** The reason code of each departure called off, by id. */
  calledOff: () => Record<string, string>;
  /** Attendance marked this session, by booking id. */
  attendance: () => Record<string, { outcome: string; arrivedAt?: string }>;
}

export function departureHandlers(deps: DepartureMockDeps) {
  const {
    url,
    requireManager,
    requireSession,
    requireWritable,
    envelope,
    allSlots,
    departureSeats,
    partyOf,
    bookingStateOf,
    cashToGiveBackOf,
    arrivalTime,
    relay,
    RFC3339,
    capacity,
    offlineSold,
    offlineEntries,
    calledOff,
    attendance,
  } = deps;

  return [
    http.post(url("/slots/:id/offline-sales"), async ({ request, params }) => {
      /*
        Everybody signed in, as in the API: `POST /slots/{id}/offline-sales` is
        plain `auth`, and its only 403 is a suspension (yuvoy-api
        `internal/server/routes.go`). The mock refused STAFF here, which is how
        the portal came to hide counter sales from the person at the counter.
      */
      const failed = requireSession(request);
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;

      const id = String(params.id);
      const slot = allSlots().find((s) => s.id === id);
      if (!slot) return envelope("not_found", "No such departure.", 404);

      const { seats } = (await request.json()) as { seats?: number };
      if (
        typeof seats !== "number" ||
        !Number.isInteger(seats) ||
        seats < 1 ||
        seats > 200
      ) {
        return envelope("invalid_input", "seats must be 1 to 200.", 400);
      }

      /*
        A REPORT, not a request. Accepted even when it is bad news: "refusing it
        would not un-sell the seats — it would only keep our numbers wrong until
        eleven people and a six-person boat meet at a jetty."
      */
      const offered = capacity()[id] ?? slot.seats;
      const previouslyOffline = offlineSold()[id] ?? 0;
      offlineSold()[id] = previouslyOffline + seats;
      const entryId = `adj_${Math.random().toString(36).slice(2, 10)}`;
      offlineEntries().push({
        id: entryId,
        slotId: id,
        seats,
        takenBack: false,
      });

      const taken = slot.sold + offlineSold()[id];
      const over = taken - offered;

      const result: Record<string, unknown> = {
        // The entry, which is what "That was a mistake" sends back (#226).
        id: entryId,
        seatsRecorded: seats,
        // Never negative: an oversell is an incident, not a number on a screen.
        seatsRemaining: Math.max(0, offered - taken),
        totalSoldOffline: (slot.seatsSoldOffline ?? 0) + offlineSold()[id],
      };

      if (over > 0) {
        // Travellers who paid us now have no seat.
        const stranded = slot.parties.filter((p) => p.bookingId).slice(0, over);
        result.oversold = {
          guests: over,
          bookings: stranded.map((p) => p.reference),
          message: `${over} ${over === 1 ? "guest has" : "guests have"} paid for a seat that no longer exists on this departure.`,
          incidentId: `inc_${id}_${Date.now().toString(36)}`,
        };
      }

      return HttpResponse.json(result);
    }),

    /*
      "That was a mistake" (yuvoy-api#226): one counter sale taken back by the
      id its record answer carried. The same people as recording one, which is
      everybody signed in. One 404 for an entry on another departure or no entry
      at all; a second take-back is `409 already_taken_back`, and nothing moves
      twice.
    */
    http.delete(
      url("/slots/:id/offline-sales/:saleId"),
      async ({ request, params }) => {
        const failed = requireSession(request);
        if (failed) return failed;
        const shut = requireWritable(request);
        if (shut) return shut;

        const id = String(params.id);
        const slot = allSlots().find((s) => s.id === id);
        const entry = offlineEntries().find(
          (e) => e.id === String(params.saleId) && e.slotId === id,
        );
        if (!slot || !entry) {
          return envelope(
            "not_found",
            "we could not find that counter sale on this departure",
            404,
          );
        }
        if (entry.takenBack) {
          return envelope(
            "already_taken_back",
            "that counter sale has already been taken back, and its seats are back on the departure",
            409,
          );
        }

        entry.takenBack = true;
        offlineSold()[id] = Math.max(0, (offlineSold()[id] ?? 0) - entry.seats);
        const { remaining, soldOffline } = departureSeats(slot);
        return HttpResponse.json({
          seatsTakenBack: entry.seats,
          seatsRemaining: remaining,
          totalSoldOffline: soldOffline,
        });
      },
    ),

    /* --------------------------------------------------------------- relay - */

    http.post(url("/bookings/:id/relay"), async ({ request, params }) =>
      relay(request, () => {
        const found = partyOf(String(params.id));
        return found ? [found.party] : null;
      }),
    ),

    http.post(url("/slots/:id/relay"), async ({ request, params }) =>
      relay(request, () => {
        const slot = allSlots().find((s) => s.id === String(params.id));
        // A live hold has no booking to message; `relay` keeps only bookings.
        return slot ? slot.parties : null;
      }),
    ),

    /* ------------------------------------------------------------- call off - */

    http.post(url("/slots/:id/call-off"), async ({ request, params }) => {
      const failed = requireManager(
        request,
        "STAFF cannot call off a departure.",
      );
      if (failed) return failed;

      const id = String(params.id);
      const slot = allSlots().find((s) => s.id === id);
      if (!slot) return envelope("not_found", "No such departure.", 404);

      if (calledOff()[id] || slot.status === "cancelled") {
        return envelope(
          "already_called_off",
          "Everybody on it has already been told.",
          409,
        );
      }

      const body = (await request.json()) as {
        reasonCode?: string;
        confirmSlotId?: string;
        note?: string;
      };

      const REASONS = [
        "weather",
        "equipment",
        "staffing",
        "safety",
        "insufficient_numbers",
      ];
      if (!body.reasonCode || !REASONS.includes(body.reasonCode)) {
        return envelope("invalid_input", "Pick a reason.", 400);
      }

      /*
        The confirmation is enforced here, not just in the UI. It is the only
        irreversible action in the portal, and a mock that accepts any string
        would let a client ship without the guard.
      */
      if (body.confirmSlotId !== id) {
        return envelope(
          "invalid_input",
          "confirmSlotId must equal the departure's own id.",
          400,
        );
      }

      const confirmed = slot.parties.filter(
        (p) => p.bookingId && bookingStateOf(p) !== "cancelled",
      );
      const holds = slot.parties.filter((p) => !p.bookingId);

      calledOff()[id] = body.reasonCode;
      const giveBack = cashToGiveBackOf(slot);

      return HttpResponse.json({
        slotId: id,
        reasonCode: body.reasonCode,
        bookingsCancelled: confirmed.length,
        guestsAffected: confirmed.reduce((n, p) => n + p.guests, 0),
        /*
          Full refunds regardless of the cancellation policy: those tiers price a
          traveller changing their mind, and nobody changed their mind here. But
          only what was captured ONLINE: a cash booking captured nothing, so it
          adds nothing here and its money is in `cashToGiveBack` instead.
        */
        refundedPaise: confirmed
          .filter((p) => !p.cash)
          .reduce((n, p) => n + p.guests * 450000, 0),
        holdsReleased: holds.length,
        ...(giveBack ? { cashToGiveBack: giveBack } : {}),
      });
    }),

    /* ---------------------------------------------------------- attendance - */

    http.post(url("/bookings/:id/attendance"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const id = String(params.id);
      const found = partyOf(id);
      if (!found) return envelope("not_found", "No such booking.", 404);

      const body = (await request.json()) as {
        outcome: string;
        seenAt?: unknown;
      };
      const { outcome } = body;
      const slot = SLOTS.find((s) => s.id === found.slotId)!;
      const departed = Date.now() >= new Date(slot.startsAt).getTime();

      /*
        `seenAt`, yuvoy-api#263 (#292), read only on `arrived`, as the API
        reads it: a string that is not an RFC 3339 time with its offset is a
        400 naming it, and nothing is marked. A field that is not a string at
        all fails the body's own read first, as it does there.
      */
      let seenAt: number | undefined;
      if (outcome === "arrived" && body.seenAt !== undefined) {
        if (typeof body.seenAt !== "string") {
          return envelope(
            "invalid_input",
            "we could not read that request",
            400,
          );
        }
        if (body.seenAt !== "") {
          const at = RFC3339.test(body.seenAt) ? Date.parse(body.seenAt) : NaN;
          if (!Number.isFinite(at)) {
            return envelope(
              "invalid_input",
              "we could not read when they were seen",
              400,
              {
                seenAt:
                  "a date-time with its offset, like 2026-10-07T06:30:00+05:30",
              },
            );
          }
          seenAt = at;
        }
      }

      const existing = attendance()[id];
      if (existing && existing.outcome !== "arrived") {
        // Re-settling is refused rather than silently overwritten.
        return envelope(
          "not_on_this_departure",
          "This booking is already settled.",
          409,
        );
      }

      if (outcome === "arrived") {
        // Idempotent: a second tap keeps the first arrival time.
        const arrivedAt = existing?.arrivedAt ?? arrivalTime(slot, seenAt);
        attendance()[id] = { outcome: "arrived", arrivedAt };
        return HttpResponse.json({ outcome: "arrived", arrivedAt });
      }

      if (!departed) {
        return envelope(
          "departure_has_not_started",
          "Wait until the trip has set off.",
          409,
        );
      }

      attendance()[id] = { outcome, arrivedAt: existing?.arrivedAt };
      return HttpResponse.json({ outcome, arrivedAt: existing?.arrivedAt });
    }),
  ];
}
