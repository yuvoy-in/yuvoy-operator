import { http, HttpResponse } from "msw";
import type { MockSlot } from "./fixtures";

/**
 * Closures, as records rather than as a list of date ranges.
 *
 * They were `{ from, to, experienceId? }` and nothing else, which could not
 * model any of what #45 needs: an id to reopen, a reason to show, a note, the
 * departures a closure holds, or a closure of ONE departure. A calendar reading
 * that list back would have had to infer "closed" from each departure's status
 * all over again — which cannot see a closed day with no departures on it, and
 * can never say why.
 */
export interface MockClosure {
  id: string;
  from: string;
  to: string;
  reasonCode: string;
  note?: string;
  experienceId?: string;
  departureId?: string;
  reopenedAt?: string;
  createdAt: string;
  /** Every departure it held when it was made. Fixed at that moment. */
  departureIds: string[];
}

/**
 * The capacity routes of the mock API: seats on a departure, closures, reopening
 * a closure and closing one departure. Moved out of `handlers.ts` as they were
 * (yuvoy-operator#178). The helpers and the state stay there. The state comes
 * in through getters in `deps`, because `__resetOperatorMocks` replaces it.
 */
export interface CapacityMockDeps {
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
  closedByAny: (slot: MockSlot) => boolean;
  slotDay: (slot: MockSlot) => string;
  /** The closures made this session. */
  blackouts: () => MockClosure[];
  /** The reason code of each departure called off, by id. */
  calledOff: () => Record<string, string>;
  /** The seats set on each departure, by id. */
  capacity: () => Record<string, number>;
  /** The departures whose seats were confirmed, by id. */
  seatsConfirmed: () => Record<string, true>;
}

export function capacityHandlers(deps: CapacityMockDeps) {
  const {
    url,
    requireManager,
    requireSession,
    requireWritable,
    envelope,
    allSlots,
    closedByAny,
    slotDay,
    blackouts,
    calledOff,
    capacity,
    seatsConfirmed,
  } = deps;

  return [
    /* ------------------------------------------------------------ capacity - */

    http.patch(url("/slots/:id"), async ({ request, params }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
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
        seats < 0 ||
        seats > 200
      ) {
        return envelope("invalid_input", "seats must be 0 to 200.", 400);
      }

      /*
        The floor is enforced, not assumed. "Not 'should not' — the database
        refuses it, because the alternative is a traveller with a paid booking
        and no seat, discovered at a jetty at six in the morning." Reducing to
        EXACTLY what is sold is allowed: it closes the departure without
        stranding anyone.

        The 409 message is written the way the contract describes — copy telling
        the operator what to do instead — because the client renders it verbatim.
      */
      if (seats < slot.sold) {
        return envelope(
          "conflict",
          `${slot.sold} seats are already sold on this departure. Set it to ${slot.sold} to close it without stranding anyone, or call the departure off.`,
          409,
        );
      }

      capacity()[id] = seats;
      /*
        Saving a seat count CONFIRMS it: `POST /slots/confirm-seats` is "the same
        confirmation that saving a seat count with `PATCH /slots/{id}` makes, over
        a range of dates". The mock only modelled the range, so a departure's own
        "Confirm seats" on the calendar (yuvoy-operator#84 s7) saved the count
        and left it off sale, which is a screen tested green against an answer
        production never gives.
      */
      seatsConfirmed()[id] = true;
      return new HttpResponse(null, { status: 204 });
    }),

    http.post(url("/blackouts"), async ({ request }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;

      const body = (await request.json()) as {
        from?: string;
        to?: string;
        reasonCode?: string;
        experienceId?: string;
        note?: string;
      };
      const REASONS = [
        "WEATHER",
        "MAINTENANCE",
        "STAFF",
        "PERSONAL",
        "SEASONAL",
        "OTHER",
      ];
      const shape = /^\d{4}-\d{2}-\d{2}$/;
      if (
        !body.from ||
        !body.to ||
        !shape.test(body.from) ||
        !shape.test(body.to)
      ) {
        return envelope("invalid_input", "from and to must be dates.", 400);
      }
      if (body.to < body.from) {
        return envelope("invalid_input", "to cannot precede from.", 400);
      }
      if (!body.reasonCode || !REASONS.includes(body.reasonCode)) {
        return envelope("invalid_input", "Unknown reasonCode.", 400);
      }

      /*
        Closing dates is NOT cancelling people. The count includes live holds,
        whose bookings predate the closure and can still complete — which is
        exactly the thing an operator assumes did not survive.

        Counted across the range whatever its departures' status, so closing a
        day twice still reports who is owed on it; a called-off departure owes
        nobody. And the closure is RECORDED, so `GET /slots` reads it back the
        way the API does — `closed`, and not on sale — for one listing when the
        body names one, and for every listing when it does not.
      */
      const inRange = allSlots().filter((s) => {
        if (calledOff()[s.id] || s.status === "cancelled") return false;
        if (body.experienceId && s.experienceId !== body.experienceId) {
          return false;
        }
        const day = slotDay(s);
        return day >= body.from! && day <= body.to!;
      });
      const existingBookings = inRange.reduce(
        (n, s) => n + s.parties.length,
        0,
      );

      /*
        The departures it holds are recorded WITH it, at this moment: "including
        any that another closure had already closed", because reopening "puts back
        exactly those departures". A closure that recomputed its scope later would
        reopen a departure added to the day afterwards, which nobody closed.
      */
      const id = `blk_${Math.random().toString(36).slice(2, 10)}`;
      blackouts().push({
        id,
        from: body.from,
        to: body.to,
        reasonCode: body.reasonCode,
        ...(body.note ? { note: body.note } : {}),
        ...(body.experienceId ? { experienceId: body.experienceId } : {}),
        createdAt: new Date().toISOString(),
        departureIds: inRange.map((s) => s.id),
      });

      return HttpResponse.json({
        id,
        closed: true,
        existingBookings,
        ...(existingBookings > 0
          ? {
              note: "The bookings you already have still stand — including anyone mid-checkout, whose hold predates the closure and can still complete. Run them, or call each departure off individually.",
            }
          : {}),
      });
    }),

    /**
     * Closures read back — yuvoy-operator#45 item 1.
     *
     * "Every closure touching the range, reopened ones included; those carry
     * `reopenedAt`." Reopened ones are sent on purpose: a mock that hid them would
     * let the portal ship without checking `reopenedAt`, and every reopened day
     * would read as closed for the rest of the season.
     */
    http.get(url("/blackouts"), async ({ request }) => {
      // "Any operator user may read it." No role gate, deliberately.
      const failed = requireSession(request);
      if (failed) return failed;

      const params = new URL(request.url).searchParams;
      const from = params.get("from") ?? "";
      const to = params.get("to") ?? "";

      /*
        "Only closures whose last day is on or after `from`" and "whose first day
        is on or before `to`" — overlap, not containment. A closure running from
        last week into next week touches this fortnight and a containment test
        would drop it, which is the one an operator would most want to see.
      */
      const touching = blackouts()
        .filter((b) => (!from || b.to >= from) && (!to || b.from <= to))
        .sort(
          (a, b) => a.from.localeCompare(b.from) || a.id.localeCompare(b.id),
        );

      const limitRaw = Number(params.get("limit"));
      const limit =
        Number.isInteger(limitRaw) && limitRaw > 0
          ? Math.min(limitRaw, 200)
          : 50;
      const cursor = params.get("cursor");
      let start = 0;
      if (cursor !== null) {
        const parsed = Number(cursor);
        if (
          !Number.isInteger(parsed) ||
          parsed < 0 ||
          parsed > touching.length
        ) {
          return envelope("invalid_input", "Not a cursor we issued.", 400);
        }
        start = parsed;
      }
      const page = touching.slice(start, start + limit);
      const end = start + page.length;

      return HttpResponse.json({
        items: page,
        // "Told rather than inferred … Do not infer the end from a short page."
        complete: end >= touching.length,
        ...(end < touching.length ? { nextCursor: String(end) } : {}),
      });
    }),

    /**
     * Reopen one closure — yuvoy-operator#45 item 2.
     *
     * The two counts are the point. "A departure it holds goes back to open only
     * if it is still closed, has not left yet, and no other closure still in force
     * holds it. **A called-off departure is never reopened.**" A mock that simply
     * dropped the closure and reported success would let the portal ship a screen
     * that says a day is back on sale when half of it is not.
     */
    http.post(url("/blackouts/:id/reopen"), async ({ request, params }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;

      const id = String(params.id);
      const closure = blackouts().find((b) => b.id === id);
      if (!closure) return envelope("not_found", "No such closure.", 404);
      if (closure.reopenedAt) {
        return envelope("already_reopened", "This was reopened before.", 409);
      }

      closure.reopenedAt = new Date().toISOString();

      /*
        Counted AFTER the closure is marked reopened, so `closedByAny` sees the
        world as it now is: a departure another closure still holds is counted as
        still closed, which is exactly what `departuresStillClosed` means.
      */
      const held = allSlots().filter((s) =>
        closure.departureIds.includes(s.id),
      );
      let reopened = 0;
      let stillClosed = 0;
      for (const slot of held) {
        // "Its departures that have already left stay closed, because they did
        // pass closed", and a called-off one is never reopened.
        if (calledOff()[slot.id] || Date.parse(slot.startsAt) <= Date.now()) {
          continue;
        }
        if (closedByAny(slot)) stillClosed += 1;
        else reopened += 1;
      }

      return HttpResponse.json({
        id,
        reopenedAt: closure.reopenedAt,
        departuresReopened: reopened,
        departuresStillClosed: stillClosed,
        // "Say this out loud. It gives both counts in words."
        note:
          stillClosed > 0
            ? `${reopened === 1 ? "1 departure is" : `${reopened} departures are`} back on sale. ${stillClosed === 1 ? "1 is" : `${stillClosed} are`} still closed by another closure.`
            : `${reopened === 1 ? "1 departure is" : `${reopened} departures are`} back on sale.`,
      });
    }),

    /**
     * Close ONE departure — yuvoy-operator#45 item 4.
     *
     * "It is a closure like a closed date: `GET /blackouts` reads it back with
     * `departureId`, and `POST /blackouts/{id}/reopen` reopens it." So it makes a
     * real closure record rather than flipping a status, which is what lets the
     * calendar offer the way back.
     */
    http.post(url("/slots/:id/close"), async ({ request, params }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;

      const id = String(params.id);
      const slot = allSlots().find((s) => s.id === id);
      if (!slot) return envelope("not_found", "No such departure.", 404);

      const body = (await request.json()) as {
        reasonCode?: string;
        note?: string;
      };
      if (
        !body.reasonCode ||
        ![
          "WEATHER",
          "MAINTENANCE",
          "STAFF",
          "PERSONAL",
          "SEASONAL",
          "OTHER",
        ].includes(body.reasonCode)
      ) {
        return envelope("invalid_input", "Unknown reasonCode.", 400);
      }

      if (calledOff()[id] || slot.status === "cancelled") {
        return envelope(
          "already_called_off",
          "This departure was called off, so there is nothing to close.",
          409,
        );
      }
      if (Date.parse(slot.startsAt) <= Date.now()) {
        return envelope("departure_started", "That departure has left.", 409);
      }

      /*
        "Closing a departure that is already closed on its own answers with the
        closure that holds it rather than making a second one." Two closures on
        one departure would need two reopens to undo one act.
      */
      const existing = blackouts().find(
        (b) => b.departureId === id && !b.reopenedAt,
      );
      const closureId =
        existing?.id ?? `blk_${Math.random().toString(36).slice(2, 10)}`;
      if (!existing) {
        const day = slotDay(slot);
        blackouts().push({
          id: closureId,
          from: day,
          to: day,
          reasonCode: body.reasonCode,
          ...(body.note ? { note: body.note } : {}),
          departureId: id,
          createdAt: new Date().toISOString(),
          departureIds: [id],
        });
      }

      const existingBookings = slot.parties.length;
      return HttpResponse.json({
        id: closureId,
        closed: true,
        existingBookings,
        ...(existingBookings > 0
          ? {
              note: "The bookings already on this departure still stand, including anyone mid-checkout. Closing it stops new ones and cancels nobody.",
            }
          : {}),
      });
    }),
  ];
}
