import { http, HttpResponse } from "msw";
import { REQUESTS, SLOTS, type MockParty } from "./fixtures";

/**
 * The bookings routes of the mock API. Moved out of `handlers.ts` as they
 * were (yuvoy-operator#178). The helpers and the state stay there. The state
 * comes in through a getter in `deps`, because `__resetOperatorMocks`
 * replaces it.
 */
export interface BookingMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
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
  /** The seat requests answered this session, by id. */
  answered: () => Record<string, "active" | "released">;
}

export function bookingHandlers(deps: BookingMockDeps) {
  const {
    url,
    requireSession,
    isNewBusiness,
    bookingMoney,
    bookingStateOf,
    bookingCashOf,
    bookingCancellationOf,
    answered,
  } = deps;

  return [
    /* ------------------------------------------------------------ bookings - */

    /**
     * The bookings, with what each contributed.
     *
     * Derived from the same `SLOTS` the manifest reads and the same `REQUESTS`
     * the queue reads, so a booking cannot appear here and nowhere else.
     * Selected on the SLOT's `startsAt`, as the contract says — when the trip
     * runs, not when it was made — which is the reason the screen must never
     * sum this list against `/earnings`.
     *
     * Money sits on captured rows only. An unanswered seat request is a
     * `pending_request` booking that has moved nothing, so it comes back with
     * no `money` at all — "absent, not zeroed" — which is the branch the screen
     * renders as "no money has moved". A live hold is not a booking and is not
     * here.
     */
    /**
     * The bookings list, with views, search, filters, counts and a cursor —
     * yuvoy-operator#57 (yuvoy-api#185).
     *
     * Every one of those is modelled rather than ignored, because the whole point
     * of the change is that the SERVER answers them: a mock that returned
     * everything and let the portal filter would let this screen ship counting
     * the rows it happened to load, which is the bug #57 exists to remove.
     */
    http.get(url("/bookings"), async ({ request }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const u = new URL(request.url);
      const from = u.searchParams.get("from");
      const to = u.searchParams.get("to");
      const view = u.searchParams.get("view");
      const q = (u.searchParams.get("q") ?? "").trim();
      const experienceId = u.searchParams.get("experienceId");

      if (view !== null && !["upcoming", "past", "cancelled"].includes(view)) {
        return HttpResponse.json(
          {
            error: {
              code: "invalid_input",
              message: "view must be upcoming, past or cancelled",
              details: { view: "must be upcoming, past or cancelled" },
            },
          },
          { status: 400 },
        );
      }
      /*
        A business with nothing on it has never been booked. It read the fixture
        dive shop's bookings before, which Home now reads as "has sold" and
        which would have ended its start-selling checklist on day one.
      */
      if (isNewBusiness(request)) {
        return HttpResponse.json({
          items: [],
          complete: true,
          counts: { requests: 0, upcoming: 0, past: 0, cancelled: 0 },
        });
      }
      if (q.length > 60) {
        return HttpResponse.json(
          {
            error: {
              code: "invalid_input",
              message: "q is at most 60 characters",
              details: { q: "at most 60 characters" },
            },
          },
          { status: 400 },
        );
      }

      /*
        MARKET days, inclusive, as the contract now reads them: "the first day to
        include, in the market's clock" (yuvoy-operator#45 item 6). Each
        departure's OWN zone, never a fixed one.
      */
      const inWindow = (startsAt: string, timezone: string) => {
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: timezone,
        }).format(new Date(startsAt));
        return (!from || day >= from) && (!to || day <= to);
      };

      /*
        "Any part of the guest's name, or any part of the reference with or
        without `YV-`, case ignored." A request has no reference, which is why
        `counts.requests` and the portal's own request filter both match by name
        alone.
      */
      const needle = q.toLowerCase();
      const matchesQ = (name: string, reference?: string) => {
        if (!needle) return true;
        if (name.toLowerCase().includes(needle)) return true;
        if (!reference) return false;
        const ref = reference.toLowerCase();
        return ref.includes(needle) || ref.replace("yv-", "").includes(needle);
      };

      const captured = SLOTS.flatMap((slot) =>
        inWindow(slot.startsAt, slot.timezone) &&
        (!experienceId || slot.experienceId === experienceId)
          ? slot.parties
              .filter((p) => p.bookingId && matchesQ(p.name, p.reference))
              .map((p) => ({
                id: p.bookingId,
                reference: p.reference,
                state: bookingStateOf(p),
                guests: p.guests,
                experience: slot.title,
                // Every row carries it, so a listing filter built from
                // `GET /experiences` lines up with these rows.
                experienceId: slot.experienceId,
                // The departure, so a booking opens it (yuvoy-api#259).
                slotId: slot.id,
                slot: { startsAt: slot.startsAt, timezone: slot.timezone },
                contact: { name: p.name },
                createdAt: new Date(
                  new Date(slot.startsAt).getTime() - 3 * 86_400_000,
                ).toISOString(),
                money: bookingMoney(p),
                // Present only on a cash booking — "branch on the key existing".
                ...(p.cash ? { cash: bookingCashOf(p) } : {}),
                ...(bookingCancellationOf(p)
                  ? { cancellation: bookingCancellationOf(p) }
                  : {}),
              }))
          : [],
      );

      const awaiting = REQUESTS.filter(
        (r) =>
          !answered()[r.id] &&
          inWindow(r.startsAt, r.timezone) &&
          (!experienceId || r.experienceId === experienceId) &&
          // By NAME alone: a request has no reference to match against.
          matchesQ(r.contactName),
      );

      /*
        Which view a booking is in, first match wins, exactly as the contract's
        table has it. A trip earlier today stays `upcoming` "until the market's
        day ends or it is marked", which is why the day is compared rather than
        the instant.
      */
      const todayMarket = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
      }).format(new Date());
      const viewOf = (b: (typeof captured)[number]) => {
        const state = String(b.state);
        if (state === "cancelled" || state === "declined") return "cancelled";
        if (state === "completed" || state === "no_show") return "past";
        const day = new Intl.DateTimeFormat("en-CA", {
          timeZone: b.slot.timezone,
        }).format(new Date(b.slot.startsAt));
        return day < todayMarket ? "past" : "upcoming";
      };

      /*
        "`counts` are totals, not the size of this page. They honour `q`,
        `experienceId`, `from` and `to`, and ignore `view`, `state`, `limit` and
        `cursor`, so the pills stay put while you switch between them."
      */
      const counts = {
        requests: awaiting.length,
        upcoming: captured.filter((b) => viewOf(b) === "upcoming").length,
        past: captured.filter((b) => viewOf(b) === "past").length,
        cancelled: captured.filter((b) => viewOf(b) === "cancelled").length,
      };

      const when = (b: (typeof captured)[number]) =>
        Date.parse(b.slot.startsAt);
      let rows = captured;
      if (view) {
        // "Upcoming soonest trip first; past and cancelled most recent first."
        rows = captured
          .filter((b) => viewOf(b) === view)
          .sort((a, b) =>
            view === "upcoming" ? when(a) - when(b) : when(b) - when(a),
          );
      } else {
        /*
          No view: every booking, soonest trip first, "as this list always was".
          The open requests come too, because that is what the older callers read.
        */
        rows = [...captured].sort((a, b) => when(a) - when(b));
      }

      const items: Record<string, unknown>[] = view
        ? [...rows]
        : [
            ...rows,
            ...awaiting.map((r) => ({
              id: r.id,
              state: "pending_request",
              guests: r.guests,
              experience: r.experience,
              experienceId: r.experienceId,
              slotId: r.slotId,
              slot: { startsAt: r.startsAt, timezone: r.timezone },
              contact: { name: r.contactName },
              createdAt: r.requestedAt,
            })),
          ];

      const limitRaw = Number(u.searchParams.get("limit"));
      const limit =
        Number.isInteger(limitRaw) && limitRaw > 0
          ? Math.min(limitRaw, 200)
          : 100;
      const cursor = u.searchParams.get("cursor");
      let start = 0;
      if (cursor !== null) {
        /*
          "A cursor this list did not issue is a `400`, and so is a cursor from
          one view sent with another." The view is encoded into the cursor for
          exactly that: a client carrying a page across a pill change would
          otherwise silently show the wrong rows.
        */
        const [cursorView, offset] = cursor.split(":");
        if (cursorView !== (view ?? "") || !Number.isInteger(Number(offset))) {
          return HttpResponse.json(
            {
              error: {
                code: "invalid_input",
                message: "cursor was issued for another list",
                details: { cursor: "issued for another list" },
              },
            },
            { status: 400 },
          );
        }
        start = Number(offset);
      }
      const page = items.slice(start, start + limit);
      const end = start + page.length;

      return HttpResponse.json({
        items: page,
        complete: end >= items.length,
        ...(end < items.length ? { nextCursor: `${view ?? ""}:${end}` } : {}),
        counts,
      });
    }),
  ];
}
