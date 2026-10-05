import { describe, expect, it } from "vitest";
import type { Commission } from "./commission";
import type { CommissionStatement } from "./commission-statements";
import {
  cashHasMoney,
  cashLead,
  cashOnTheTab,
  commissionOnTheTab,
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

/** One weekly commission statement, as `GET /commission-statements` lists it. */
function statement(
  over: Partial<CommissionStatement> = {},
): CommissionStatement {
  return {
    id: "cst_1",
    reference: "YC-7KQ2MZ9P",
    weekStart: "2026-09-21",
    weekEnd: "2026-09-27",
    state: "issued",
    bookings: 2,
    farePaise: 1_500_000,
    commissionPaise: 225_000,
    paidPaise: 0,
    owedPaise: 225_000,
    issuedAt: "2026-09-29T03:30:00Z",
    ...over,
  };
}

/** Two statements still to pay, one paid, one settled: ₹3,550 owed. */
const OWING = commissionOnTheTab({
  items: [
    statement(),
    statement({
      id: "cst_2",
      state: "part_paid",
      commissionPaise: 330_000,
      paidPaise: 200_000,
      owedPaise: 130_000,
    }),
    statement({ id: "cst_3", state: "paid", paidPaise: 225_000, owedPaise: 0 }),
    statement({ id: "cst_4", state: "waived", owedPaise: 0 }),
  ],
  complete: true,
});

/** Statements, every one of them paid or settled. */
const SETTLED = commissionOnTheTab({
  items: [statement({ state: "paid", paidPaise: 225_000, owedPaise: 0 })],
  complete: true,
});

/** No statement yet: a read that answered with nothing to bill. */
const NO_BILL = commissionOnTheTab({ items: [], complete: true });

/** A business with no cash at all, whose owed read ANSWERED. */
const ZERO_COMMISSION: Commission = {
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
    expect(cash.completedShare).toBe(450_000);
    expect(cash.heldShare).toBe(225_000);
    expect(cash.toRun).toEqual({
      bookings: 3,
      farePaise: 2_700_000,
      // From the overview, so it survives the owed read failing.
      takenPaise: 1_500_000,
    });
    expect(cash.cashKnown).toBe(true);
    expect(cash.unrecorded).toEqual({ bookings: 1, farePaise: 450_000 });
    expect(cashHasMoney(cash)).toBe(true);
  });

  it("says nothing about the share when the cash read failed, rather than ₹0", () => {
    /*
      `GET /commission-owed` is read softly on this screen. A failed read must
      leave its figures unsaid: a ₹0 drawn from silence is a figure nobody can
      tell from a real one.
    */
    const cash = cashOnTheTab(COUNTER, null);
    expect(cash.inHand).toBeNull();
    expect(cash.completedShare).toBeNull();
    expect(cash.heldShare).toBeNull();
    // What the overview itself carries still stands, held cash included.
    expect(cash.toRun?.bookings).toBe(3);
    expect(cash.toRun?.takenPaise).toBe(1_500_000);
    expect(cash.cashKnown).toBe(false);
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
    const cash = cashOnTheTab(NO_CASH, ZERO_COMMISSION);
    expect(cash.unrecorded).toBeNull();
    expect(cashHasMoney(cash)).toBe(false);
  });

  it("has something to say when the owed read failed: that it could not check", () => {
    /*
      The audit, M3: with an empty week and `/commission-owed` answering 500,
      the screen said "Nothing owed either way yet" to an operator who owed
      ₹4,500 on completed cash trips, which only that read can say.
    */
    expect(cashHasMoney(cashOnTheTab(NO_CASH, null))).toBe(true);
  });

  it("does not call past trips still to run against an API older than #221", () => {
    // Its `bookings` still carried past trips with nothing recorded.
    const older = {
      ...COUNTER,
      unrecordedBookings: undefined,
      unrecordedFarePaise: undefined,
    } as unknown as PaidAtCounter;
    expect(cashOnTheTab(older, COMMISSION).toRun).toBeNull();
  });
});

describe("the figure the cash block leads with", () => {
  it("is the cash in hand when there is any", () => {
    expect(cashLead(cashOnTheTab(COUNTER, COMMISSION))).toEqual({
      kind: "in-hand",
      paise: 4_200_000,
    });
  });

  it("is the cash still to take when nothing has been taken: #87 s15's own case", () => {
    /*
      "The screen leads with ₹0, and the only real number, ₹55,250 of cash
      still to collect, is third and smallest." Five trips to run, nothing
      taken, nothing owed.
    */
    const counter: PaidAtCounter = {
      ...NO_CASH,
      bookings: 5,
      farePaise: 5_525_000,
    };
    expect(cashLead(cashOnTheTab(counter, ZERO_COMMISSION))).toEqual({
      kind: "to-take",
      paise: 5_525_000,
    });
  });

  it("is Yuvoy's share on completed trips when that is the only real figure", () => {
    /*
      Never called owed: `/commission-owed` counts every completed trip,
      billed or not and paid or not (op#121).
    */
    expect(
      cashLead(
        cashOnTheTab(NO_CASH, {
          ...ZERO_COMMISSION,
          collectedPaise: undefined,
          commissionPaise: 450_000,
        }),
      ),
    ).toEqual({ kind: "share", paise: 450_000 });
  });

  it("is nothing when every figure is zero or unknown, never a ₹0", () => {
    expect(cashLead(cashOnTheTab(NO_CASH, ZERO_COMMISSION))).toBeNull();
    expect(cashLead(cashOnTheTab(NO_CASH, null))).toBeNull();
  });
});

describe("what the Money tab leads with", () => {
  const PAYOUT = { bookings: 6, netPaise: 4_015_000 };
  const EMPTY_WEEK = { bookings: 0, netPaise: 0 };
  const BOOKED = { bookings: 4, netPaise: 3_060_000 };
  const NOT_BOOKED = { bookings: 0, netPaise: 0 };
  const CASH = cashOnTheTab(COUNTER, COMMISSION);
  const NONE = cashOnTheTab(NO_CASH, ZERO_COMMISSION);
  const FAILED = cashOnTheTab(NO_CASH, null);

  it("leads with the payout when it has money in it", () => {
    expect(moneyBlocks(PAYOUT, BOOKED, CASH, NO_BILL)).toEqual([
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
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, CASH, NO_BILL)).toEqual([
      "cash",
      "payout-quiet",
    ]);
    expect(moneyBlocks(EMPTY_WEEK, BOOKED, NONE, NO_BILL)).toEqual([
      "booked",
      "payout-quiet",
    ]);
  });

  it("says an empty week once, rather than three times as ₹0", () => {
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, NONE, NO_BILL)).toEqual([
      "nothing-yet",
    ]);
  });

  it("never says nothing is owed when the owed read failed", () => {
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, FAILED, NO_BILL)).toEqual([
      "cash",
      "payout-quiet",
    ]);
  });

  it("never draws an empty block", () => {
    expect(moneyBlocks(PAYOUT, NOT_BOOKED, NONE, NO_BILL)).toEqual(["payout"]);
  });

  /*
    The weekly commission bill (op#121, D-043). What is owed on it is the one
    thing on the tab to do, and the email with each statement sends people
    here, so it leads.
  */
  it("leads with commission to pay, above even a payout", () => {
    expect(moneyBlocks(PAYOUT, BOOKED, CASH, OWING)).toEqual([
      "commission",
      "payout",
      "booked",
      "cash",
    ]);
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, NONE, OWING)).toEqual([
      "commission",
      "payout-quiet",
    ]);
  });

  it("lists settled statements below everything, with nothing to pay", () => {
    expect(moneyBlocks(PAYOUT, BOOKED, CASH, SETTLED)).toEqual([
      "payout",
      "booked",
      "cash",
      "commission-quiet",
    ]);
    // Nothing owed either way is still true when every bill is paid.
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, NONE, SETTLED)).toEqual([
      "nothing-yet",
      "commission-quiet",
    ]);
  });

  it("never says nothing is owed when the statements did not load", () => {
    const failed = commissionOnTheTab(null);
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, NONE, failed)).toEqual([
      "commission-unknown",
      "payout-quiet",
    ]);
    // Said after the payout and what is booked, before cash.
    expect(moneyBlocks(PAYOUT, BOOKED, CASH, failed)).toEqual([
      "payout",
      "booked",
      "commission-unknown",
      "cash",
    ]);
  });

  it("draws a total it cannot add up as a bill, never as settled", () => {
    // A list cut short understates the bill: the rows are still drawn.
    const cutShort = commissionOnTheTab({
      items: [statement({ state: "paid", owedPaise: 0 })],
      complete: false,
    });
    expect(cutShort.owedPaise).toBeNull();
    expect(moneyBlocks(EMPTY_WEEK, NOT_BOOKED, NONE, cutShort)).toEqual([
      "commission",
      "payout-quiet",
    ]);
  });
});

describe("what the Money tab knows about the commission bill", () => {
  it("adds up what is owed across every statement", () => {
    expect(OWING).toEqual({
      read: true,
      owedPaise: 355_000,
      statements: OWING.statements,
    });
  });

  it("is unknown, never zero, when the read failed", () => {
    expect(commissionOnTheTab(null)).toEqual({
      read: false,
      owedPaise: null,
      statements: [],
    });
  });

  it("is nothing owed with no statements at all", () => {
    expect(NO_BILL).toEqual({ read: true, owedPaise: 0, statements: [] });
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
