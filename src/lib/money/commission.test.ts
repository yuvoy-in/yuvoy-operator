import { describe, it, expect } from "vitest";
import { cashInHand, linesReconcile, toCommission } from "./commission";

const line = (over: Record<string, unknown> = {}) => ({
  bookingReference: "YV-8F3K2A",
  tripDate: "2026-09-14",
  guests: 2,
  farePaise: 1_000_000,
  collectedPaise: 1_000_000,
  commissionPaise: 150_000,
  ...over,
});

/*
  What the contract requires beside the owed figures since the 22 Sep pin: cash
  held for trips still to run, and trips that ran with no cash recorded. Zero
  here, because these tests are about what is owed.
*/
const NOTHING_ELSE = {
  collectedPaise: 0,
  heldBookings: 0,
  heldFarePaise: 0,
  heldCollectedPaise: 0,
  heldCommissionPaise: 0,
  heldLines: [],
  unrecordedBookings: 0,
  unrecordedFarePaise: 0,
  unrecordedLines: [],
};

describe("what is owed on cash — yuvoy-operator#40 §2", () => {
  it("carries the totals and every line through", () => {
    const c = toCommission({
      ...NOTHING_ELSE,
      bookings: 1,
      farePaise: 1_000_000,
      commissionPaise: 150_000,
      lines: [line()],
    });
    expect(c.bookings).toBe(1);
    expect(c.farePaise).toBe(1_000_000);
    expect(c.commissionPaise).toBe(150_000);
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0].bookingReference).toBe("YV-8F3K2A");
  });

  it("never aggregates the lines away — they ARE the screen", () => {
    /*
      "A bill that first appears as a demand gets argued about. One that has
      been visible all along, with the trips behind it listed, gets paid."
      Three trips in, three trips out.
    */
    const c = toCommission({
      ...NOTHING_ELSE,
      bookings: 3,
      farePaise: 3_000_000,
      commissionPaise: 450_000,
      lines: [
        line({ bookingReference: "A", tripDate: "2026-09-10" }),
        line({ bookingReference: "B", tripDate: "2026-09-14" }),
        line({ bookingReference: "C", tripDate: "2026-09-12" }),
      ],
    });
    expect(c.lines).toHaveLength(3);
  });

  it("puts the most recent trip first, so two loads agree", () => {
    const c = toCommission({
      ...NOTHING_ELSE,
      bookings: 3,
      farePaise: 0,
      commissionPaise: 0,
      lines: [
        line({ bookingReference: "OLD", tripDate: "2026-09-10" }),
        line({ bookingReference: "NEW", tripDate: "2026-09-14" }),
        line({ bookingReference: "MID", tripDate: "2026-09-12" }),
      ],
    });
    expect(c.lines.map((l) => l.bookingReference)).toEqual([
      "NEW",
      "MID",
      "OLD",
    ]);
  });

  it("keeps a line with no trip date, at the end", () => {
    // Money owed is money owed. Dropping it would stop the lines adding up to
    // the total above them, which is the one thing this screen promises.
    const c = toCommission({
      ...NOTHING_ELSE,
      bookings: 2,
      farePaise: 0,
      commissionPaise: 0,
      lines: [
        line({ bookingReference: "NODATE", tripDate: undefined }),
        line({ bookingReference: "DATED", tripDate: "2026-09-14" }),
      ],
    });
    expect(c.lines.map((l) => l.bookingReference)).toEqual(["DATED", "NODATE"]);
  });

  it("keeps an absent `collectedPaise` absent rather than zero", () => {
    /*
      A zero rendered where the server said nothing reads as "they took
      nothing" — a statement about an operator's honesty, not a missing number.
    */
    const c = toCommission({
      ...NOTHING_ELSE,
      bookings: 1,
      farePaise: 0,
      commissionPaise: 0,
      lines: [line({ collectedPaise: undefined })],
    });
    expect(c.lines[0].collectedPaise).toBeUndefined();
  });

  it("treats a missing total as zero rather than NaN", () => {
    const c = toCommission({} as Parameters<typeof toCommission>[0]);
    expect(c.bookings).toBe(0);
    expect(c.farePaise).toBe(0);
    expect(c.commissionPaise).toBe(0);
    expect(c.lines).toEqual([]);
  });
});

describe("whether the lines account for the total", () => {
  it("reconciles when they add up", () => {
    expect(
      linesReconcile(
        toCommission({
          ...NOTHING_ELSE,
          bookings: 2,
          farePaise: 1_500_000,
          commissionPaise: 225_000,
          lines: [
            line({ commissionPaise: 150_000 }),
            line({ commissionPaise: 75_000, bookingReference: "B" }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("does not reconcile when a share is missing from the lines", () => {
    /*
      A reconciliation screen that cannot reconcile is worse than no screen:
      the operator finds it with a calculator and stops trusting the number.
    */
    expect(
      linesReconcile(
        toCommission({
          ...NOTHING_ELSE,
          bookings: 2,
          farePaise: 1_500_000,
          commissionPaise: 300_000,
          lines: [
            line({ commissionPaise: 150_000 }),
            line({ commissionPaise: 75_000, bookingReference: "B" }),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("does not reconcile when a page of lines is short of the count", () => {
    expect(
      linesReconcile(
        toCommission({
          ...NOTHING_ELSE,
          bookings: 9,
          farePaise: 1_000_000,
          commissionPaise: 150_000,
          lines: [line()],
        }),
      ),
    ).toBe(false);
  });

  it("reconciles the empty case, which is the common one", () => {
    expect(
      linesReconcile(
        toCommission({
          ...NOTHING_ELSE,
          bookings: 0,
          farePaise: 0,
          commissionPaise: 0,
          lines: [],
        }),
      ),
    ).toBe(true);
  });

  it("reconciles a shortfall row: the share is owed on the FARE", () => {
    /*
      "Our commission is owed on the fare, not on what you chose to take. A
      discount you gave is yours to have given." So a line whose
      `collectedPaise` is under its fare still contributes its full share, and
      the screen must not read that as an error.
    */
    const c = toCommission({
      ...NOTHING_ELSE,
      bookings: 1,
      farePaise: 1_500_000,
      commissionPaise: 225_000,
      lines: [
        line({
          farePaise: 1_500_000,
          collectedPaise: 1_200_000,
          commissionPaise: 225_000,
        }),
      ],
    });
    expect(linesReconcile(c)).toBe(true);
    expect(c.lines[0].collectedPaise).toBe(1_200_000);
  });
});

describe("held for trips still to run, and unrecorded: yuvoy-operator#94", () => {
  const withHeld = {
    ...NOTHING_ELSE,
    bookings: 1,
    farePaise: 1_000_000,
    collectedPaise: 1_000_000,
    commissionPaise: 150_000,
    lines: [line()],
    heldBookings: 2,
    heldFarePaise: 1_500_000,
    heldCollectedPaise: 1_500_000,
    heldCommissionPaise: 225_000,
    heldLines: [
      line({ bookingReference: "LATER", tripDate: "2026-09-30" }),
      line({ bookingReference: "SOONER", tripDate: "2026-09-25" }),
    ],
    unrecordedBookings: 1,
    unrecordedFarePaise: 600_000,
    unrecordedLines: [
      line({
        bookingReference: "RAN",
        tripDate: "2026-09-20",
        collectedPaise: 0,
      }),
    ],
  };

  it("carries the held figures, soonest trip first", () => {
    const c = toCommission(withHeld);
    expect(c.held).toMatchObject({
      bookings: 2,
      farePaise: 1_500_000,
      collectedPaise: 1_500_000,
      commissionPaise: 225_000,
    });
    expect(c.held?.lines.map((l) => l.bookingReference)).toEqual([
      "SOONER",
      "LATER",
    ]);
  });

  it("carries the trips that ran with no cash recorded", () => {
    const c = toCommission(withHeld);
    expect(c.unrecorded).toMatchObject({ bookings: 1, farePaise: 600_000 });
    expect(c.unrecorded?.lines[0].bookingReference).toBe("RAN");
  });

  it("adds owed and held into the cash in hand", () => {
    // "collectedPaise plus heldCollectedPaise is all the cash you have
    // recorded taking on those bookings."
    expect(cashInHand(toCommission(withHeld))).toBe(2_500_000);
  });

  it("reads an older API, with none of the new figures, as unknown not zero", () => {
    const older = {
      bookings: 1,
      farePaise: 1_000_000,
      commissionPaise: 150_000,
      lines: [line()],
    } as Parameters<typeof toCommission>[0];
    const c = toCommission(older);
    expect(c.held).toBeNull();
    expect(c.unrecorded).toBeNull();
    expect(c.collectedPaise).toBeUndefined();
    expect(cashInHand(c)).toBeNull();
  });

  it("reconciles the held lines against the held share on their own", () => {
    const c = toCommission({
      ...withHeld,
      heldLines: [
        line({ commissionPaise: 150_000 }),
        line({ commissionPaise: 75_000, bookingReference: "B" }),
      ],
    });
    expect(c.held && linesReconcile(c.held)).toBe(true);
  });
});
