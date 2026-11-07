import { http, HttpResponse } from "msw";
import {
  SLOTS,
  type MockParty,
  type MockSlot,
  type MockTeamMember,
} from "./fixtures";

/**
 * The day routes of the mock API: creating departures, a departure's day
 * sheet and the day's departures. Moved out of `handlers.ts` as they were
 * (yuvoy-operator#178). The helpers and the state stay there. The state comes
 * in through getters in `deps`, because `__resetOperatorMocks` replaces it.
 */
export interface DayMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  requireWritable: (request: Request) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  sessionUser: (request: Request) => MockTeamMember | null;
  canManage: (member: MockTeamMember) => boolean;
  isNewBusiness: (request: Request) => boolean;
  allSlots: () => MockSlot[];
  slotDay: (slot: MockSlot) => string;
  slotStatusOf: (slot: MockSlot) => string;
  saleVerdictOf: (
    slot: MockSlot,
    seats: number,
    sold: number,
  ) => { onSale: boolean; notOnSaleReason?: string; notOnSaleDetail?: string };
  departureSeats: (slot: MockSlot) => {
    seats: number;
    sold: number;
    remaining: number;
    soldOffline: number;
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
  unreadOf: (bookingId: string) => number;
  /** Attendance marked this session, by booking id. */
  attendance: () => Record<string, { outcome: string; arrivedAt?: string }>;
  /** The reason code of each departure called off, by id. */
  calledOff: () => Record<string, string>;
  /** The departures created this session. */
  createdSlots: () => MockSlot[];
  /** The listings, as far as these routes read them. */
  mockExperiences: () => { id: string; status: string }[];
}

export function dayHandlers(deps: DayMockDeps) {
  const {
    url,
    requireSession,
    requireWritable,
    envelope,
    sessionUser,
    canManage,
    isNewBusiness,
    allSlots,
    slotDay,
    slotStatusOf,
    saleVerdictOf,
    departureSeats,
    bookingStateOf,
    bookingCashOf,
    cashToGiveBackOf,
    unreadOf,
    attendance,
    calledOff,
    createdSlots,
    mockExperiences,
  } = deps;

  return [
    /* --------------------------------------------------------- the day ----- */

    /**
     * Create departures — the one thing the capacity screen could not do.
     *
     * Two behaviours are modelled rather than stubbed, because the screen is
     * built around both:
     *
     * 1. **The cross product.** A range and a list of times make one departure
     *    per combination, filtered by `weekdays` where given. That is what makes
     *    an untouched date field expensive, and it is what the form's live count
     *    is checked against.
     * 2. **Idempotence.** "Dates that already have a departure at that time are
     *    left alone, so `created: 0` is a legitimate answer and not a failure."
     *    A mock that created duplicates would let this portal ship a receipt for
     *    a state the API never produces.
     *
     * A listing that is not this operator's answers **404, never 403** — the
     * contract chose that so a refusal cannot confirm the listing exists.
     */
    http.post(url("/slots"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;
      const me = sessionUser(request)!;
      if (!canManage(me)) {
        return envelope("forbidden", "STAFF cannot add departures.", 403);
      }

      const body = (await request.json()) as {
        experienceId?: string;
        fromDate?: string;
        toDate?: string;
        times?: string[];
        weekdays?: number[];
        seats?: number;
        capacity?: number;
        durationMinutes?: number;
        cutoffHours?: number;
      };

      const listing = [...SLOTS, ...createdSlots()].find(
        (s) => s.experienceId === body.experienceId,
      );
      if (!listing) return envelope("not_found", "No such listing.", 404);

      const times = (body.times ?? []).filter((t) => /^\d{2}:\d{2}$/.test(t));
      const seats = body.seats ?? 0;
      if (!body.fromDate || !times.length || seats < 1) {
        return envelope(
          "bad_request",
          "A date, a time and seats are needed.",
          400,
        );
      }

      const from = Date.parse(`${body.fromDate}T00:00:00Z`);
      const to = Date.parse(`${body.toDate || body.fromDate}T00:00:00Z`);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
        return envelope("bad_request", "That date range runs backwards.", 400);
      }

      const wanted = new Set(body.weekdays ?? []);
      const existing = new Set(
        [...SLOTS, ...createdSlots()]
          .filter((s) => s.experienceId === body.experienceId)
          .map((s) => `${s.startsAt}`),
      );

      let created = 0;
      for (let t = from; t <= to; t += 86_400_000) {
        const d = new Date(t);
        if (wanted.size && !wanted.has(d.getUTCDay())) continue;
        const day = d.toISOString().slice(0, 10);
        for (const time of times) {
          // The market is +05:30 and every fixture departure is stored that way.
          const startsAt = `${day}T${time}:00+05:30`;
          if (existing.has(startsAt)) continue;
          existing.add(startsAt);
          created += 1;
          createdSlots().push({
            id: `slot_new_${createdSlots().length}_${day.replace(/-/g, "")}_${time.replace(":", "")}`,
            experienceId: listing.experienceId,
            title: listing.title,
            startsAt,
            timezone: listing.timezone,
            seats,
            sold: 0,
            remaining: seats,
            bookingMode: listing.bookingMode,
            status: "open",
            meetingPoint: listing.meetingPoint,
            parties: [],
            seatsSoldOffline: 0,
          });
        }
      }

      /*
        Whether those departures actually sell — yuvoy-operator#30 §4.

        Departures on a draft listing stay creatable, deliberately ("a calendar
        you cannot fill in before the listing is approved is not a calendar").
        What was wrong was the silence: the screen said "they are on sale from
        now" unconditionally. The mock answers from the listing's real status, so
        the false claim is reachable in a test rather than only in production.
      */
      const owner = mockExperiences().find((e) => e.id === body.experienceId);
      const onSale = owner ? owner.status === "live" : true;

      return HttpResponse.json(
        {
          created,
          onSale,
          ...(onSale
            ? {}
            : {
                notOnSaleReason:
                  owner?.status === "draft"
                    ? "listing_draft"
                    : "listing_unpriced",
                notOnSaleDetail:
                  "These are on your calendar, but the activity is still a draft — nobody can book them until it is approved.",
              }),
          note:
            created === 0
              ? "Every one of those already had a departure at that time."
              : "They are on sale now.",
        },
        { status: 201 },
      );
    }),

    http.get(url("/slots"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;
      if (isNewBusiness(request)) {
        return HttpResponse.json({ items: [], complete: true });
      }

      const u = new URL(request.url);
      const from = u.searchParams.get("from");
      const to = u.searchParams.get("to");

      /*
        MARKET days, inclusive, as the contract now reads them: "the first day to
        include, in the market's clock" on both ends (yuvoy-operator#45 item 6).

        This filtered on UTC days, faithfully, because that is what the API did —
        `from` was UTC midnight and `to` ran to the next one — and it is why
        `listSlots` widened its window by a day either side and threw the extra
        back. Both halves have gone: the range asked for is the range meant, and a
        04:00 IST departure lists under its own day rather than the evening
        before.

        Created departures are read back like any other. A mock whose reads ignore
        its writes proves the message rendered and nothing about the row.
      */
      const inRange = allSlots().filter((s) => {
        const day = slotDay(s);
        return (!from || day >= from) && (!to || day <= to);
      });

      /*
        What was WRITTEN is what is read back. For its first month this handler
        returned the fixture's numbers whatever the session had done to them, so
        every revalidate-after-write showed the pre-write state: "Now offering
        6." beside a row still saying "11 left", a called-off departure still
        open on /today. A mock whose reads ignore its writes is a suite that
        proves the message rendered and nothing about the screen.
      */
      return HttpResponse.json({
        items: inRange.map((s) => {
          const { seats, sold, remaining, soldOffline } = departureSeats(s);
          return {
            id: s.id,
            experienceId: s.experienceId,
            title: s.title,
            startsAt: s.startsAt,
            timezone: s.timezone,
            seats,
            sold,
            remaining,
            // Always sent since 2afd7b4, 0 when none (yuvoy-api#226).
            soldOffline,
            // Omitted when the fixture omits it. One departure has no mode on
            // purpose: the screen must say nothing rather than assume held seats.
            ...(s.bookingMode ? { bookingMode: s.bookingMode } : {}),
            status: slotStatusOf(s),
            ...saleVerdictOf(s, seats, sold),
          };
        }),
        /*
          Told rather than left out. `GET /slots` is paged in the contract and
          `listSlots` walks it until this says so; a mock omitting it would let a
          client ship that stops at the first page and never notice.
        */
        complete: true,
      });
    }),

    http.get(url("/slots/:id/manifest"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const slot = allSlots().find((s) => s.id === String(params.id));
      // Missing and "belongs to somebody else" are one answer, by design.
      if (!slot) return envelope("not_found", "No such departure.", 404);

      /*
        Who is on the boat, as the API reads it (yuvoy-api#204): nobody on a
        departure that was called off, and never a cancelled booking. "`parties`
        is who is on the boat, and somebody cancelled is not."
      */
      const wasCalledOff = Boolean(calledOff()[slot.id] || slot.calledOff);
      const onBoard = wasCalledOff
        ? []
        : slot.parties.filter(
            (p) => !p.bookingId || bookingStateOf(p) !== "cancelled",
          );

      const parties = onBoard.map((p) => {
        const recorded = attendance()[p.bookingId];
        /*
          `cash` is sent on a party that pays at the counter, the same object
          `GET /bookings` sends, and on nobody else (yuvoy-api#204). It used to
          be held back here, when the contract carried none and the screen
          joined `GET /bookings` instead. `unreachable` is this mock's own and
          never leaves it.
        */
        const { cash: _cash, unreachable: _unreachable, ...party } = p;
        void _cash;
        void _unreachable;
        const cash = p.bookingId ? bookingCashOf(p) : undefined;
        return {
          ...party,
          state: p.bookingId ? bookingStateOf(p) : p.state,
          arrived: recorded ? true : p.arrived,
          arrivedAt: recorded?.arrivedAt ?? p.arrivedAt,
          ...(cash ? { cash } : {}),
          /*
            The count the conversation list gives the same booking, `0` when
            none (yuvoy-api#260). Absent on a hold: no booking, no conversation.
          */
          ...(p.bookingId ? { unreadCount: unreadOf(p.bookingId) } : {}),
        };
      });

      const giveBack = cashToGiveBackOf(slot);
      const seats = departureSeats(slot);

      const guests = parties.reduce((n, p) => n + p.guests, 0);

      return HttpResponse.json({
        slotId: slot.id,
        experience: slot.title,
        startsAt: slot.startsAt,
        timezone: slot.timezone,
        meetingPoint: slot.meetingPoint,
        status: calledOff()[slot.id] ? "cancelled" : slot.status,
        ...(calledOff()[slot.id]
          ? { calledOff: { reasonCode: calledOff()[slot.id] } }
          : slot.calledOff
            ? { calledOff: slot.calledOff }
            : {}),
        parties,
        ...(giveBack ? { cashToGiveBack: giveBack } : {}),
        totals: {
          parties: parties.length,
          guests,
          // Guests, not parties: the API adds up each arrived party's guests.
          arrived: parties
            .filter((p) => p.arrived)
            .reduce((n, p) => n + (p.guests ?? 0), 0),
          // The same arithmetic `GET /slots` answers with, so the two agree.
          seatsSold: seats.sold,
          // Counter sales recorded this session count, as they would.
          seatsSoldOffline: seats.soldOffline,
          // The departure's seats, the counter's already off (yuvoy-api#260).
          seats: seats.seats,
        },
      });
    }),
  ];
}
