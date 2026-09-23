import { describe, expect, it } from "vitest";
import type { Commission } from "./commission";
import {
  cashHasMoney,
  cashOnTheTab,
  latestStatement,
  moneyBlocks,
  pageCursor,
  payoutHasMoney,
  pipelineHasMoney,
  seasonLine,
} from "./overview";
import type { PaidAtCounter, Settlement } from "./settlements";

/*
  What the Money tab leads with (yuvoy-operator#96, #87 s15): "The screen
  leads with ₹0, and the only real number, ₹55,250 of cash still to collect,
  is third and smallest." Each block says whether it has anything in it, so
  the screen can draw the real ones first and say an empty week once.
*/

const COUNTER: PaidAtCounter = {
  bookings: 3,
  farePaise: 2_700_000,
  commissionPaise: 405_000,
  netPaise: 2_295_000,
  heldBookings: 2,
  heldCollectedPaise: 1_500_000,
  unrecordedBookings: 1,
  unrecordedFarePaise: 450_000,
  unrecordedLines: [],
};

const NO_CASH: PaidAtCounter = {
  bookings: 0,
  farePaise: 0,
  commissionPaise: 0,
  netPaise: 0,
  heldBookings: 0,
  heldCollectedPaise: 0,
  unrecordedBookings: 0,
  unrecordedFarePaise: 0,
  unrecordedLines: [],
};

const COMMISSION: Commission = {
  bookings: 3,
  farePaise: 3_000_000,
  collectedPaise: 2_700_000,
  commissionPaise: 450_000,
  lines: [],
  held: {
    bookings: 2,
    farePaise: 1_500_000,
    collectedPaise: 1_500_000,
    commissionPaise: 225_000,
    lines: [],
  },
  unrecorded: { bookings: 1, farePaise: 450_000, lines: [] },
};

describe("whether the next payout has anything in it", () => {
  it("does when it pays bookings", () => {
    expect(payoutHasMoney({ bookings: 6, netPaise: 4_015_000 })).toBe(true);
  });

  it("does when a correction alone moves it, even below zero", () => {
    // The minus sign is the message: nothing is paid until it is settled.
    expect(payoutHasMoney({ bookings: 0, netPaise: -125_000 })).toBe(true);
  });

  it("does not when it is an empty week", () => {
    expect(payoutHasMoney({ bookings: 0, netPaise: 0 })).toBe(false);
  });
});

describe("whether any card booking is still to run", () => {
  it("does with bookings, and does not without", () => {
    expect(pipelineHasMoney({ bookings: 4, netPaise: 3_060_000 })).toBe(true);
    expect(pipelineHasMoney({ bookings: 0, netPaise: 0 })).toBe(false);
  });
});

describe("the cash the Money tab summarises", () => {
  it("leads with all the cash in hand, as the Cash screen does", () => {
    const cash = cashOnTheTab(COUNTER, COMMISSION);
    // Owed-now collected (27,000) plus held collected (15,000).
    expect(cash.inHand).toBe(4_200_000);
    expect(cash.owedNow).toBe(450_000);
    expect(cash.heldShare).toBe(225_000);
    expect(cash.toRun).toEqual({ bookings: 3, farePaise: 2_700_000 });
    expect(cash.unrecorded).toEqual({ bookings: 1, farePaise: 450_000 });
    expect(cashHasMoney(cash)).toBe(true);
  });

  it("says nothing about owing when the cash read failed, rather than ₹0", () => {
    /*
      `GET /commission-owed` is read softly on this screen. A failed read must
      leave the owed figure unsaid: "₹0 owed" drawn from silence tells an
      operator with a balance that they owe nothing.
    */
    const cash = cashOnTheTab(COUNTER, null);
    expect(cash.inHand).toBeNull();
    expect(cash.owedNow).toBeNull();
    expect(cash.heldShare).toBeNull();
    // What the overview itself carries still stands.
    expect(cash.toRun.bookings).toBe(3);
    expect(cash.unrecorded).toEqual({ bookings: 1, farePaise: 450_000 });
    expect(cashHasMoney(cash)).toBe(true);
  });

  it("reads unrecorded trips from the cash read when the overview is older", () => {
    const older = {
      ...COUNTER,
      unrecordedBookings: undefined,
      unrecordedFarePaise: undefined,
    } as unknown as PaidAtCounter;
    expect(cashOnTheTab(older, COMMISSION).unrecorded).toEqual({
      bookings: 1,
      farePaise: 450_000,
    });
    // And from neither, it is simply not there.
    expect(cashOnTheTab(older, null).unrecorded).toBeNull();
  });

  it("has nothing to say about a business with no cash at all", () => {
    const none: Commission = {
      bookings: 0,
      farePaise: 0,
      collectedPaise: 0,
      commissionPaise: 0,
      lines: [],
      held: {
        bookings: 0,
        farePaise: 0,
        collectedPaise: 0,
        commissionPaise: 0,
        lines: [],
      },
      unrecorded: { bookings: 0, farePaise: 0, lines: [] },
    };
    const cash = cashOnTheTab(NO_CASH, none);
    expect(cash.unrecorded).toBeNull();
    expect(cashHasMoney(cash)).toBe(false);
    expect(cashHasMoney(cashOnTheTab(NO_CASH, null))).toBe(false);
  });
});

describe("what the Money tab leads with", () => {
  const PAYOUT = { bookings: 6, netPaise: 4_015_000 };
  const EMPTY_WEEK = { bookings: 0, netPaise: 0 };
  const BOOKED = { bookings: 4, netPaise: 3_060_000 };
  const NOT_BOOKED = { bookings: 0, netPaise: 0 };
  const CASH = cashOnTheTab(COUNTER, COMMISSION);
  const NONE = cashOnTheTab(NO_CASH, null);

  it("leads with the payout when it has money in it", () => {
    expect(moneyBlocks(PAYOUT, BOOKED, CASH)).toEqual([
      "payout",
      "booked",
      "cash",
    ]);
  });

  it("leads with the number that is real when the payout is empty", () => {
    /*
      Production's own screen: a ₹0 payout on top, and the only real figure,
      the cash, third and smallest. The empty card goes below, in words.
    */
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, CASH)).toEqual([
      "cash",
      "payout-quiet",
    ]);
    expect(moneyBlocks(EMPTY_WEEK, BOOKED, NONE)).toEqual([
      "booked",
      "payout-quiet",
    ]);
  });

  it("says an empty week once, rather than three times as ₹0", () => {
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, NONE)).toEqual(["nothing-yet"]);
  });

  it("never draws an empty block", () => {
    expect(moneyBlocks(PAYOUT, NOT_BOOKED, NONE)).toEqual(["payout"]);
  });
});

describe("the season, in one line", () => {
  it("names its start, what was sent and how many payouts", () => {
    expect(
      seasonLine({
        from: "2026-04-01",
        settlements: 18,
        bookings: 214,
        grossPaise: 192_600_000,
        commissionPaise: 28_890_000,
        refundsPaise: 7_200_000,
        adjustmentsPaise: -340_000,
        netPaise: 156_170_000,
      }),
    ).toBe("Since 1 April 2026: ₹15,61,700 sent in 18 payouts.");
  });

  it("says one payout, not one payouts", () => {
    expect(
      seasonLine({
        from: "2026-04-01",
        settlements: 1,
        bookings: 2,
        grossPaise: 0,
        commissionPaise: 0,
        refundsPaise: 0,
        adjustmentsPaise: 0,
        netPaise: 900_000,
      }),
    ).toBe("Since 1 April 2026: ₹9,000 sent in 1 payout.");
  });

  it("says nothing before the first payout of the season", () => {
    expect(
      seasonLine({
        from: "2026-04-01",
        settlements: 0,
        bookings: 0,
        grossPaise: 0,
        commissionPaise: 0,
        refundsPaise: 0,
        adjustmentsPaise: 0,
        netPaise: 0,
      }),
    ).toBeNull();
  });
});

describe("the page a Show more link asked for", () => {
  it("passes an opaque cursor through untouched", () => {
    expect(pageCursor("c_2026-08-17_stl")).toBe("c_2026-08-17_stl");
  });

  it("asks for the first page when there is no usable cursor", () => {
    expect(pageCursor(undefined)).toBeUndefined();
    expect(pageCursor("   ")).toBeUndefined();
    // `?cursor=a&cursor=b` is not a page anybody was offered.
    expect(pageCursor(["a", "b"])).toBeUndefined();
    expect(pageCursor("x".repeat(513))).toBeUndefined();
  });
});

describe("the statement to offer", () => {
  const week = (id: string, state: Settlement["state"]): Settlement => ({
    id,
    periodStart: "2026-08-31",
    periodEnd: "2026-09-06",
    state,
    bookings: 1,
    grossPaise: 0,
    commissionPaise: 0,
    refundsPaise: 0,
    adjustmentsPaise: 0,
    netPaise: 0,
  });

  it("is the newest payout that was sent, passing over ones that were not", () => {
    // A locked or approved week has no statement: the download would 409.
    expect(
      latestStatement([
        week("locked", "locked"),
        week("approved", "approved"),
        week("sent", "settled"),
        week("older", "settled"),
      ])?.id,
    ).toBe("sent");
  });

  it("is nothing when no payout has been sent yet", () => {
    expect(latestStatement([week("locked", "locked")])).toBeNull();
    expect(latestStatement([])).toBeNull();
  });
});
