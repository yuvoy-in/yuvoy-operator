import { http, HttpResponse } from "msw";
import type { MockParty, MockSlot } from "./fixtures";
import type { MockExperience } from "./experience-handlers";
import type { MockMediaAsset } from "./media-handlers";
import type { MockQuestion } from "./listing-handlers";

/**
 * The schedule routes of the mock API: a listing's workspace, saving its
 * weekly schedule, confirming seats and moving a departure's time. Moved out
 * of `handlers.ts` as they were (yuvoy-operator#178). The helpers and the
 * state stay there. The state comes in through getters in `deps`, because
 * `__resetOperatorMocks` replaces it.
 */
export interface ScheduleMockDeps {
  url: (path: string) => string;
  requireSession: (request: Request) => Response | null;
  requireWritable: (request: Request) => Response | null;
  requireManager: (request: Request, refusal: string) => Response | null;
  envelope: (
    code: string,
    message: string,
    status: number,
    details?: unknown,
  ) => Response;
  withPin: <
    T extends { meetingLat?: number | null; meetingLng?: number | null },
  >(
    listing: T,
  ) => T & { meetingLat: number | null; meetingLng: number | null };
  allSlots: () => MockSlot[];
  slotDay: (slot: MockSlot) => string;
  slotStatusOf: (slot: MockSlot) => string;
  departureSeats: (slot: MockSlot) => {
    seats: number;
    sold: number;
    remaining: number;
    soldOffline: number;
  };
  saleVerdictOf: (
    slot: MockSlot,
    seats: number,
    sold: number,
  ) => { onSale: boolean; notOnSaleReason?: string; notOnSaleDetail?: string };
  seatsAwaitingConfirmation: (slot: MockSlot) => boolean;
  bookingStateOf: (p: MockParty) => string;
  bookableDatesOf: (e: { id?: string; status?: string }) => number;
  unconfirmedDeparturesOf: (e: { id?: string }) => number;
  situationOf: (asset: MockMediaAsset) => string;
  /** The questions per listing, by listing id. */
  listingQuestions: Record<string, MockQuestion[]>;
  /** The listings. */
  mockExperiences: () => MockExperience[];
  /** The media library, by id. */
  mediaAssets: () => Record<string, MockMediaAsset>;
  /** The departures whose seats were confirmed this session, by id. */
  seatsConfirmed: () => Record<string, true>;
  /** The reason code of each departure called off, by id. */
  calledOff: () => Record<string, string>;
  /** The departures moved to a new time this session, by id. */
  movedTimes: () => Record<string, string>;
}

export function scheduleHandlers(deps: ScheduleMockDeps) {
  const {
    url,
    requireSession,
    requireWritable,
    requireManager,
    envelope,
    withPin,
    allSlots,
    slotDay,
    slotStatusOf,
    departureSeats,
    saleVerdictOf,
    seatsAwaitingConfirmation,
    bookingStateOf,
    bookableDatesOf,
    unconfirmedDeparturesOf,
    situationOf,
    listingQuestions,
    mockExperiences,
    mediaAssets,
    seatsConfirmed,
    calledOff,
    movedTimes,
  } = deps;

  return [
    /**
     * One listing and everything attached to it — yuvoy-operator#56 item 6.
     *
     * The whole point of the endpoint is that it is ONE request: "building a
     * listing meant fetching the whole calendar and the whole media library to
     * find the handful of rows that belong to it. On island 4G that is three
     * requests and most of a business's data to render one screen."
     */
    http.get(url("/experiences/:id/workspace"), async ({ request, params }) => {
      const failed = requireSession(request);
      if (failed) return failed;

      const id = String(params.id);
      const listing = mockExperiences().find((e) => e.id === id);
      // Gone and belonging-to-somebody-else are one answer, as everywhere else.
      if (!listing) return envelope("not_found", "No such listing.", 404);

      /*
        "Its own departures that have NOT YET LEFT, soonest first." A departure
        that has gone is read from `GET /slots` with a date range, so a mock that
        sent them here would let the hub ship a list of boats nobody can act on.
      */
      const departures = allSlots()
        .filter(
          (slot) =>
            slot.experienceId === id && Date.parse(slot.startsAt) > Date.now(),
        )
        .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
        .slice(0, 200)
        .map((slot) => {
          const { seats, sold, remaining, soldOffline } = departureSeats(slot);
          return {
            id: slot.id,
            experienceId: slot.experienceId,
            title: slot.title,
            startsAt: slot.startsAt,
            timezone: slot.timezone,
            seats,
            sold,
            remaining,
            soldOffline,
            ...(slot.bookingMode ? { bookingMode: slot.bookingMode } : {}),
            status: slotStatusOf(slot),
            ...saleVerdictOf(slot, seats, sold),
          };
        });

      return HttpResponse.json({
        listing: {
          ...withPin(listing),
          // The single listing carries these too (yuvoy-api#205, #211).
          bookableDatesNext30Days: bookableDatesOf(listing),
          departuresNotOnSale: unconfirmedDeparturesOf(listing),
          departuresGoingOffSaleSoon: 0,
        },
        departures,
        /*
          The listing's own media, matched on the NESTED `listing.experienceId`
          that `OperatorMedia` actually carries.
        */
        media: Object.entries(mediaAssets())
          .filter(([, asset]) => asset.listing?.experienceId === id)
          .map(([mediaId, asset]) => ({
            id: mediaId,
            kind: asset.kind,
            state: asset.state,
            ...(asset.posterUrl ? { posterUrl: asset.posterUrl } : {}),
            listing: asset.listing,
            situation: situationOf(asset),
          })),
        /*
          The listing's own questions, "exactly as `GET /experiences/{id}/questions`
          returns it". It was a hardcoded empty list, which meant the builder's
          Questions step could never show a question it had just saved and the
          Review step counted none no matter what was there.
        */
        questions: listingQuestions[id] ?? [],
      });
    }),

    /**
     * Save the whole weekly schedule — yuvoy-operator#56 item 8.
     *
     * Whole, which is what makes an empty save dangerous: a row left out is a row
     * removed. The mock records it so the hub reads back what it saved, and
     * answers the `note` the screen renders verbatim.
     */
    http.put(url("/experiences/:id/schedule"), async ({ request, params }) => {
      const failed = requireManager(
        request,
        "Requires OWNER, ADMIN or MANAGER.",
      );
      if (failed) return failed;
      const shut = requireWritable(request);
      if (shut) return shut;

      const listing = mockExperiences().find((e) => e.id === String(params.id));
      if (!listing) return envelope("not_found", "No such listing.", 404);

      const body = (await request.json()) as {
        weekly?: { weekday?: number; startTime?: string; seats?: number }[];
      };
      const weekly = body.weekly ?? [];

      /*
        `details` names the row AND the field — keys like `weekly[2].startTime` —
        so a form can mark that row rather than printing one sentence above seven
        of them. Modelled, because a mock that answered a bare 400 would let the
        portal ship without ever rendering a row problem.
      */
      const details: Record<string, string> = {};
      /*
        "Every weekday and time the listing runs, each at most once." A second
        row at a weekday and time already sent is refused on that row, as every
        other row problem is: a mock that took it would let a form ship that can
        send a week the API refuses.
      */
      const sent = new Set<string>();
      weekly.forEach((row, i) => {
        const slot = `${row.weekday}|${row.startTime}`;
        if (sent.has(slot)) {
          details[`weekly[${i}].startTime`] =
            "That weekday already leaves at this time.";
        }
        sent.add(slot);
        if (
          !Number.isInteger(row.weekday) ||
          (row.weekday ?? -1) < 0 ||
          (row.weekday ?? 7) > 6
        ) {
          details[`weekly[${i}].weekday`] = "Sunday to Saturday, as 0 to 6.";
        }
        if (!/^\d{2}:\d{2}$/.test(String(row.startTime))) {
          details[`weekly[${i}].startTime`] = "Times look like 07:00.";
        }
        if (
          !Number.isInteger(row.seats) ||
          (row.seats ?? 0) < 1 ||
          (row.seats ?? 0) > 200
        ) {
          details[`weekly[${i}].seats`] = "Seats are 1 to 200.";
        }
      });
      if (Object.keys(details).length > 0) {
        return HttpResponse.json(
          {
            error: {
              code: "invalid_input",
              message: "Some rows need fixing.",
              details,
            },
          },
          { status: 400 },
        );
      }

      const before = listing.schedule?.weekly.length ?? 0;
      listing.schedule = {
        repeatsWeekly: weekly.length > 0,
        // Read back "by weekday from Sunday, then by time", as the API orders it.
        weekly: weekly
          .map((row) => ({
            weekday: row.weekday!,
            startTime: row.startTime!,
            seats: row.seats!,
          }))
          .sort(
            (a, b) =>
              a.weekday - b.weekday || a.startTime.localeCompare(b.startTime),
          ),
      };

      return HttpResponse.json({
        onSale: listing.sellable !== false,
        note:
          weekly.length === 0
            ? `The weekly schedule is removed. ${before} ${before === 1 ? "departure it made is" : "departures it made are"} closed to new bookings, and the bookings on them stay.`
            : `${weekly.length} ${weekly.length === 1 ? "day" : "days"} a week, from now on.`,
        ...(listing.sellable === false
          ? {
              notOnSaleDetail:
                "This listing is not selling, so none of these departures can be booked yet.",
            }
          : {}),
      });
    }),

    /**
     * Move one departure — yuvoy-operator#56 item 9.
     *
     * All three refusals are modelled, because each is a different sentence on
     * screen and none of them would ever render against a permissive mock: too
     * close to its start, a different day, and a time this listing already has.
     */
    /**
     * Confirm the seats on many departures at once (yuvoy-api#211), as the API
     * answers it since #244 (yuvoy-api#241): OWNER, ADMIN or MANAGER; one
     * listing when `experienceId` is sent, and another business's listing
     * answers 404. Two forms, told apart the way the handler tells them apart:
     *
     *   - **No dates** (no body, `{}`, or only `experienceId`): every departure
     *     `departuresNotOnSale` counts, however far ahead. The one call behind
     *     "Confirm all".
     *   - **`from` and `to`**: market days, both included, at most 30 days
     *     apart, as before.
     *
     * One date without the other is neither form and answers 400, with the
     * handler's sentence and a detail naming the missing one. Safe to send
     * twice: a second call confirms nothing and says 0.
     *
     * The API from before #244 is not modelled here: the portal's fallback for
     * it is driven by the unit tests (`confirm-seats.test.ts`).
     */
    http.post(url("/slots/confirm-seats"), async ({ request }) => {
      const denied = requireManager(request, "STAFF cannot confirm seats.");
      if (denied) return denied;

      const body = ((await request.json().catch(() => null)) ?? {}) as {
        from?: unknown;
        to?: unknown;
        experienceId?: unknown;
      };
      // Absent, null and "" are all "not sent", as Go's zero value reads them.
      const sent = (v: unknown) => v !== undefined && v !== null && v !== "";
      if (sent(body.from) !== sent(body.to)) {
        const [missing, other] = sent(body.from)
          ? ["to", "from"]
          : ["from", "to"];
        return envelope(
          "invalid_input",
          "send both dates, or neither to confirm every departure that needs it",
          400,
          { [missing]: `needed with ${other}` },
        );
      }
      const ranged = sent(body.from);
      const isDay = (v: unknown): v is string =>
        typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      if (
        ranged &&
        (!isDay(body.from) || !isDay(body.to) || body.to < body.from)
      ) {
        return envelope(
          "invalid_input",
          "from and to must be dates, from first",
          400,
        );
      }
      if (ranged) {
        const span =
          (Date.parse(`${body.to}T00:00:00Z`) -
            Date.parse(`${body.from}T00:00:00Z`)) /
          86_400_000;
        if (span > 30) {
          return envelope("invalid_input", "at most 31 days at a time", 400);
        }
      }
      const experienceId =
        typeof body.experienceId === "string" ? body.experienceId : "";
      if (
        experienceId &&
        !mockExperiences().some((e) => e.id === experienceId)
      ) {
        return envelope("not_found", "we could not find that listing", 404);
      }

      /*
        With dates, the API counts every departure it re-stamps: each open,
        future one in the window whose seats were set by hand, waiting or not.
        The mock knows only which were waiting, so it counts those, a smaller
        number on the same screen. With no dates the two agree: the API
        confirms exactly what the counts include, which is what
        `unconfirmedDeparturesOf` counts here.
      */
      let confirmed = 0;
      for (const slot of allSlots()) {
        if (experienceId && slot.experienceId !== experienceId) continue;
        if (slotStatusOf(slot) !== "open") continue;
        if (Date.parse(slot.startsAt) <= Date.now()) continue;
        if (ranged) {
          const day = slotDay(slot);
          if (day < String(body.from) || day > String(body.to)) continue;
        }
        if (!seatsAwaitingConfirmation(slot)) continue;
        seatsConfirmed()[slot.id] = true;
        confirmed += 1;
      }
      return HttpResponse.json({ confirmed });
    }),

    http.patch(url("/slots/:id/time"), async ({ request, params }) => {
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

      const { startsAt } = (await request.json()) as { startsAt?: string };
      const when = Date.parse(String(startsAt));
      if (Number.isNaN(when)) {
        return envelope("invalid_input", "startsAt must be an instant.", 400);
      }

      if (calledOff()[id] || Date.parse(slot.startsAt) <= Date.now()) {
        return envelope("departure_started", "It has already left.", 409);
      }
      /*
        "The new time has to be on the same day", compared in the departure's own
        market clock: an instant sent as UTC would read as the previous evening
        for a 05:00 boat, which is exactly the mistake this refusal exists for.
      */
      const dayOf = (iso: string) =>
        new Intl.DateTimeFormat("en-CA", { timeZone: slot.timezone }).format(
          new Date(iso),
        );
      if (dayOf(String(startsAt)) !== dayOf(slot.startsAt)) {
        return envelope("different_day", "Same day only.", 409);
      }
      const clash = allSlots().some(
        (other) =>
          other.id !== id &&
          other.experienceId === slot.experienceId &&
          Date.parse(other.startsAt) === when,
      );
      if (clash) {
        return envelope("time_taken", "Already a departure at that time.", 409);
      }

      movedTimes()[id] = new Date(when).toISOString();
      /*
        `bookingsTold` counts messages actually queued (yuvoy-api#200): a live
        booking we hold a reachable address for. The rest are
        `bookingsNotReached`, present only when above zero.
      */
      const live = slot.parties.filter(
        (p) => p.bookingId && bookingStateOf(p) !== "cancelled",
      );
      const told = live.filter((p) => !p.unreachable).length;
      const notReached = live.length - told;
      return HttpResponse.json({
        id,
        startsAt: movedTimes()[id],
        bookingsTold: told,
        ...(notReached > 0 ? { bookingsNotReached: notReached } : {}),
        note: `Moved. ${told} ${told === 1 ? "traveller has" : "travellers have"} been told, and each can cancel for a full refund until it leaves.`,
      });
    }),
  ];
}
