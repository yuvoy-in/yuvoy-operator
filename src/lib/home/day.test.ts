import { describe, expect, it } from "vitest";
import type { Manifest, OperatorSlot } from "@/lib/day/types";
import type { HomeListing } from "./listings";
import {
  cashToCollect,
  checkedIn,
  departureState,
  holdsPeople,
  runDay,
} from "./day";

const NOW = Date.parse("2026-09-22T03:00:00Z"); // 08:30 in the market

function slot(over: Partial<OperatorSlot> = {}): OperatorSlot {
  return {
    id: "slot_1",
    experienceId: "exp_live",
    title: "Dawn dive",
    startsAt: "2026-09-22T05:30:00Z", // 11:00 in the market, still to come
    timezone: "Asia/Kolkata",
    seats: 8,
    sold: 3,
    remaining: 5,
    bookingMode: "allotment",
    status: "open",
    onSale: true,
    ...over,
  };
}

const LIVE: HomeListing = {
  id: "exp_live",
  title: "Dawn dive",
  status: "live",
  publicationState: "published",
  sentBack: false,
};
const DRAFT: HomeListing = {
  id: "exp_draft",
  title: "Puppy Therapy",
  status: "draft",
  publicationState: "draft",
  sentBack: false,
};

function manifest(parties: Manifest["parties"]): Manifest {
  return { slotId: "slot_1", parties };
}

/*
  yuvoy-operator#82 s1: "A listing still in Draft has departures running
  today." #96 block 3: "Only departures that can hold people: no drafts, no
  closed."
*/
describe("which departures are part of the day", () => {
  it("leaves out a draft listing's departures, which nobody could book", () => {
    expect(
      holdsPeople(slot({ experienceId: "exp_draft", sold: 0 }), DRAFT),
    ).toBe(false);
  });

  it("leaves out a called-off departure, whose bookings were all cancelled", () => {
    expect(holdsPeople(slot({ status: "cancelled", sold: 4 }), LIVE)).toBe(
      false,
    );
  });

  it("leaves out a closed departure with nobody on it", () => {
    expect(holdsPeople(slot({ status: "closed", sold: 0 }), LIVE)).toBe(false);
  });

  it("keeps a departure somebody is booked on, closed or on a draft", () => {
    /*
      Closing stops new bookings and keeps the ones already made, and a
      counter sale can put people on anything. Hiding either would hide
      people who are coming.
    */
    expect(holdsPeople(slot({ status: "closed", sold: 4 }), LIVE)).toBe(true);
    expect(
      holdsPeople(slot({ experienceId: "exp_draft", sold: 2 }), DRAFT),
    ).toBe(true);
  });

  it("keeps a departure whose listing it cannot find, rather than guessing", () => {
    expect(holdsPeople(slot({ sold: 0 }), undefined)).toBe(true);
  });
});

describe("what a departure is doing, in words", () => {
  it("says the seats when none are sold", () => {
    expect(departureState(slot({ sold: 0, seats: 6 }), NOW)).toEqual({
      state: "6 seats, none sold",
      tone: "attention",
    });
  });

  it("says full, not a count of zero seats", () => {
    expect(departureState(slot({ sold: 8, seats: 8 }), NOW).state).toBe("Full");
    expect(
      departureState(
        slot({ onSale: false, notOnSaleReason: "departure_full" }),
        NOW,
      ).state,
    ).toBe("Full");
  });

  it("says off sale, and why when the reason is one to act on", () => {
    expect(
      departureState(
        slot({ onSale: false, notOnSaleReason: "departure_seats_unconfirmed" }),
        NOW,
      ),
    ).toEqual({ state: "Off sale: seats not confirmed", tone: "attention" });
    expect(
      departureState(
        slot({ onSale: false, notOnSaleReason: "sales_paused" }),
        NOW,
      ).state,
    ).toBe("Not on sale");
    // Past its cutoff is the day running normally, not an alarm.
    expect(
      departureState(
        slot({ onSale: false, notOnSaleReason: "departure_past_cutoff" }),
        NOW,
      ),
    ).toEqual({ state: "Sales closed", tone: "quiet" });
  });

  it("says seats left only where seats are held", () => {
    expect(departureState(slot(), NOW).state).toBe("5 seats left");
    // A request departure holds nothing until the operator says yes.
    expect(departureState(slot({ bookingMode: "request" }), NOW).state).toBe(
      "On sale",
    );
    // And a departure that does not say its mode is not guessed into one.
    expect(departureState(slot({ bookingMode: undefined }), NOW).state).toBe(
      "On sale",
    );
  });

  it("never counts below zero seats left", () => {
    /*
      No seat count set and two sold at the counter. It cannot be called full
      — "full" is measured against a count this departure does not have — and
      "-2 seats left" is not a number anybody can act on.
    */
    expect(departureState(slot({ seats: 0, sold: 2 }), NOW).state).toBe(
      "0 seats left",
    );
  });

  it("says a closed departure is closed, and a boat that has left has left", () => {
    expect(departureState(slot({ status: "closed" }), NOW).state).toBe(
      "Closed to new bookings",
    );
    expect(
      departureState(slot({ startsAt: "2026-09-22T01:30:00Z" }), NOW).state,
    ).toBe("Departed");
  });
});

describe("cash still to take on a departure", () => {
  it("adds up the fares not yet taken, and counts the parties", () => {
    expect(
      cashToCollect(
        manifest([
          {
            bookingId: "b1",
            state: "confirmed",
            guests: 2,
            cash: { collectPaise: 900_000, collected: false },
          },
          {
            bookingId: "b2",
            state: "confirmed",
            guests: 3,
            cash: { collectPaise: 1_350_000, collected: false },
          },
          // Taken already, and a recorded time is a recorded collection.
          {
            bookingId: "b3",
            state: "confirmed",
            guests: 1,
            cash: {
              collectPaise: 450_000,
              collected: false,
              collectedAt: "2026-09-22T02:00:00Z",
            },
          },
          // Paid online: owes nothing.
          { bookingId: "b4", guests: 1 },
          // A hold owes nothing yet.
          {
            bookingId: "",
            guests: 2,
            cash: { collectPaise: 900_000, collected: false },
          },
        ]),
      ),
    ).toEqual({ parties: 2, collectPaise: 2_250_000 });
  });

  it("says the sum is unknown rather than understating it", () => {
    expect(
      cashToCollect(
        manifest([
          {
            bookingId: "b1",
            state: "confirmed",
            guests: 2,
            cash: { collectPaise: 900_000, collected: false },
          },
          {
            bookingId: "b2",
            state: "confirmed",
            guests: 2,
            // A fare that did not come back.
            cash: { collected: false } as never,
          },
        ]),
      ),
    ).toEqual({ parties: 2, collectPaise: null });
  });
});

describe("seats sold at the counter", () => {
  /*
    yuvoy-api#226: `soldOffline` is taken off `seats` and is not in `sold`, so
    a boat whose only guests walked up to the counter read as empty on Home.
  */
  it("keeps a closed or draft departure somebody walked up to", () => {
    expect(
      holdsPeople(slot({ status: "closed", sold: 0, soldOffline: 2 }), LIVE),
    ).toBe(true);
    expect(
      holdsPeople(
        slot({ experienceId: "exp_draft", sold: 0, soldOffline: 1 }),
        DRAFT,
      ),
    ).toBe(true);
  });

  it("never says none sold, names the walk-ups, and counts them as guests", () => {
    const day = runDay({
      caption: "Today",
      now: NOW,
      listings: [LIVE],
      slots: [slot({ sold: 0, seats: 4, remaining: 4, soldOffline: 2 })],
    });
    expect(day.rows[0].state).toBe("4 seats left · 2 at your counter");
    expect(day.rows[0].state).not.toMatch(/none sold/);
    expect(day.summary).toBe("1 departure · 2 guests");
  });

  it("says nothing about the counter once the boat has left", () => {
    const day = runDay({
      caption: "Today",
      now: NOW,
      listings: [LIVE],
      slots: [
        slot({
          startsAt: "2026-09-22T01:30:00Z",
          sold: 1,
          soldOffline: 2,
        }),
      ],
    });
    expect(day.rows[0].state).toBe("Departed");
  });

  it("reads exactly as before against an API that sends no count", () => {
    const day = runDay({
      caption: "Today",
      now: NOW,
      listings: [LIVE],
      slots: [slot({ sold: 0, seats: 6, remaining: 6 })],
    });
    expect(day.rows[0].state).toBe("6 seats, none sold");
    expect(day.summary).toBe("1 departure · 0 guests");
  });
});

describe("cash only where the manifest will take it", () => {
  /*
    The audit before the #96 release: Home said "Collect ₹5,000" about a
    no-show, and about a trip that completed on its own six hours later, which
    is counted again under "no payment recorded". The manifest takes cash only
    on a booking that is `paid_pending_ops` or `confirmed`.
  */
  it("leaves out a no-show, a completed trip, and a party with no state", () => {
    const owed = (state?: string) => ({
      bookingId: `b_${state ?? "none"}`,
      guests: 2,
      ...(state ? { state } : {}),
      cash: { collectPaise: 500_000, collected: false },
    });
    expect(
      cashToCollect(
        manifest([
          owed("paid_pending_ops"),
          owed("confirmed"),
          owed("no_show"),
          owed("completed"),
          owed(),
        ]),
      ),
    ).toEqual({ parties: 2, collectPaise: 1_000_000 });
  });
});

describe("checked in, as the manifest counts it", () => {
  it("uses the server's totals, which the departure's screen shows", () => {
    const m: Manifest = {
      slotId: "slot_1",
      parties: [
        { bookingId: "b1", guests: 2, state: "confirmed", arrived: true },
        { bookingId: "", guests: 1, state: "holding", arrived: false },
      ],
      // Counted on the server, holds included, in guests.
      totals: { parties: 2, guests: 3, arrived: 2 },
    };
    expect(checkedIn(m, true)).toBe("2 of 3 checked in");
  });

  it("counts for itself only when the answer carries no totals", () => {
    expect(
      checkedIn(
        manifest([
          { bookingId: "b1", guests: 2, state: "confirmed", arrived: true },
          { bookingId: "b2", guests: 1, state: "confirmed", arrived: false },
        ]),
        true,
      ),
    ).toBe("2 of 3 checked in");
  });
});

describe("the day's sheet", () => {
  it("counts only what runs, and says it all on each row", () => {
    const day = runDay({
      caption: "Today",
      now: NOW,
      listings: [LIVE, DRAFT],
      slots: [
        slot({ id: "a", sold: 5, seats: 8, remaining: 3 }),
        slot({ id: "draft", experienceId: "exp_draft", sold: 0 }),
        slot({ id: "off", status: "cancelled", sold: 4 }),
        slot({
          id: "b",
          startsAt: "2026-09-22T08:30:00Z",
          sold: 6,
          seats: 6,
          remaining: 0,
        }),
      ],
      manifests: new Map([
        [
          "a",
          manifest([
            {
              bookingId: "b1",
              state: "confirmed",
              guests: 2,
              arrived: true,
              cash: { collectPaise: 900_000, collected: false },
            },
            { bookingId: "b2", guests: 3, arrived: false },
          ]),
        ],
        ["b", null],
      ]),
    });

    expect(day.heading).toBe("Today · 2 departures · 11 guests");
    expect(day.summary).toBe("2 departures · 11 guests");
    expect(day.rows).toEqual([
      {
        id: "a",
        time: "11:00",
        title: "Dawn dive",
        state: "3 seats left",
        tone: "ok",
        sold: 5,
        seats: 8,
        checkedIn: "2 of 5 checked in",
        collect: "₹9,000 to collect",
      },
      {
        id: "b",
        time: "14:00",
        title: "Dawn dive",
        state: "Full",
        tone: "ok",
        sold: 6,
        seats: 6,
      },
    ]);
  });

  it("says nobody has checked in only once that is news", () => {
    const upcoming = runDay({
      caption: "Today",
      now: NOW,
      listings: [LIVE],
      slots: [slot({ id: "a" })],
      manifests: new Map([
        ["a", manifest([{ bookingId: "b1", guests: 3, arrived: false }])],
      ]),
    });
    expect(upcoming.rows[0].checkedIn).toBeUndefined();

    const gone = runDay({
      caption: "Today",
      now: NOW,
      listings: [LIVE],
      slots: [slot({ id: "a", startsAt: "2026-09-22T01:30:00Z" })],
      manifests: new Map([
        ["a", manifest([{ bookingId: "b1", guests: 3, arrived: false }])],
      ]),
    });
    expect(gone.rows[0].checkedIn).toBe("0 of 3 checked in");
  });

  it("says one departure and one guest in the singular, and an empty day as zero", () => {
    expect(
      runDay({
        caption: "Tomorrow",
        now: NOW,
        listings: null,
        slots: [slot({ sold: 1 })],
      }).heading,
    ).toBe("Tomorrow · 1 departure · 1 guest");
    expect(
      runDay({ caption: "Today", now: NOW, listings: [], slots: [] }).heading,
    ).toBe("Today · 0 departures · 0 guests");
  });
});
