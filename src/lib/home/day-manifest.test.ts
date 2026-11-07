import { describe, expect, it } from "vitest";
import type { Manifest } from "@/lib/day/types";
import { cashToCollect, checkedIn } from "./day";
import { manifest } from "./day-kit";

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
