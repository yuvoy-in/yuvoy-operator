import { describe, it, expect } from "vitest";
import {
  SETTLEMENT_STATE_LABEL,
  hasStatement,
  isOwedBack,
  showsAdjustments,
  weekLabel,
  dayWithWeekday,
  longDay,
  seasonStartLabel,
  nextSettlementNote,
  stateLine,
  statementFilename,
} from "./settlements";

/**
 * What a payout says (yuvoy-operator#47).
 *
 * This is a money screen, so the tests are about the sentences an operator will
 * act on: whether a figure is owed back, whether a statement exists, and which
 * of three states has actually moved money.
 */
describe("the three states, and which one has moved money", () => {
  it("calls a sent payout Paid, not Settled", () => {
    /*
      Three words to us, three different promises to an operator. Getting
      `approved` and `settled` the wrong way round tells somebody money has
      moved when it has not.
    */
    expect(SETTLEMENT_STATE_LABEL.locked).toBe("Locked");
    expect(SETTLEMENT_STATE_LABEL.approved).toBe("Approved");
    expect(SETTLEMENT_STATE_LABEL.settled).toBe("Paid");
  });

  it("offers a statement only for a payout that has been sent", () => {
    /*
      The endpoint answers `409 not_settled` otherwise, so offering the button
      earlier is a download that always fails. The contract: "only a sent one
      has a statement."
    */
    expect(hasStatement({ state: "settled" })).toBe(true);
    expect(hasStatement({ state: "approved" })).toBe(false);
    expect(hasStatement({ state: "locked" })).toBe(false);
  });
});

describe("the line under a payout's heading", () => {
  it("says when a sent payout was paid, in the market's calendar", () => {
    // 18:30 UTC on the 7th is already the 8th on the islands.
    expect(
      stateLine({ state: "settled", settledAt: "2026-09-07T18:30:00Z" }),
    ).toBe("Paid on 8 September 2026");
  });

  it("says Paid alone when the time is missing or unreadable", () => {
    expect(stateLine({ state: "settled" })).toBe("Paid");
    expect(stateLine({ state: "settled", settledAt: "yesterday" })).toBe(
      "Paid",
    );
  });

  it("says what a week not yet sent is waiting for", () => {
    /*
      On its own page the state is the heading's only context, and "Locked"
      alone does not say whether anybody still has to act.
    */
    expect(stateLine({ state: "approved" })).toBe(
      "Approved, waiting to be sent",
    );
    expect(stateLine({ state: "locked" })).toBe(
      "Locked, waiting to be approved",
    );
  });
});

describe("a figure below zero", () => {
  it("is recognised rather than hidden", () => {
    /*
      A week goes negative when a correction is larger than what it pays, and
      the contract says that week "is not paid until somebody at Yuvoy decides
      how to recover it". The minus sign IS the message.
    */
    expect(isOwedBack(-125000)).toBe(true);
    expect(isOwedBack(0)).toBe(false);
    expect(isOwedBack(125000)).toBe(false);
  });
});

describe("the adjustments line", () => {
  it("is drawn only when there is a correction", () => {
    // A row reading "Adjustments ₹0" on every payout trains somebody to stop
    // reading the block that occasionally matters.
    expect(showsAdjustments(-45000)).toBe(true);
    expect(showsAdjustments(45000)).toBe(true);
    expect(showsAdjustments(0)).toBe(false);
  });
});

describe("naming a payout week", () => {
  it("reads as one span, with no comma and a three-letter month", () => {
    /*
      `en-IN` emits "Mon, 8 Sept" on its own. Built from parts so the span
      reads the way the issue specifies.
    */
    expect(weekLabel("2026-09-08", "2026-09-14")).toBe(
      "Tue 8 Sep to Mon 14 Sep",
    );
    expect(dayWithWeekday("2026-09-08")).toBe("Tue 8 Sep");
  });

  it("reads a date in the MARKET's day, not the reader's", () => {
    /*
      A payout week is Monday to Sunday "in your market's clock". A bare date
      read as UTC midnight is the previous evening in Asia/Kolkata, which would
      name every week boundary a day early for anybody west of it.
    */
    expect(dayWithWeekday("2026-01-01")).toBe("Thu 1 Jan");
    expect(dayWithWeekday("2026-10-01")).toBe("Thu 1 Oct");
  });

  it("crosses a year without renaming the day", () => {
    expect(weekLabel("2026-12-28", "2027-01-03")).toBe(
      "Mon 28 Dec to Sun 3 Jan",
    );
  });
});

describe("the sentence under the next settlement", () => {
  it("hedges both claims, because both are outside our control", () => {
    /*
      Three people at Yuvoy lock, approve and send a week, and the bank decides
      when it lands. Without "at the earliest" and "can still change" this
      reads as a promise of a date.
    */
    const note = nextSettlementNote("2026-09-15");
    expect(note).toBe(
      "Paid from Tuesday 15 September at the earliest. These figures can still change.",
    );
    expect(note).toContain("at the earliest");
    expect(note).toContain("can still change");
  });

  it("names the day in full, with no comma", () => {
    expect(longDay("2026-09-15")).toBe("Tuesday 15 September");
  });
});

describe("naming a season", () => {
  it("gives the day, month and year", () => {
    // "Since 1 April 2026". A season is the financial year today.
    expect(seasonStartLabel("2026-04-01")).toBe("1 April 2026");
  });
});

describe("the statement's filename", () => {
  const week = {
    id: "stl_01J8ZQ",
    periodStart: "2026-09-08",
    periodEnd: "2026-09-14",
  };

  it("uses the server's name when it gives a plain one", () => {
    expect(
      statementFilename('attachment; filename="payout-2026-w37.csv"', week),
    ).toBe("payout-2026-w37.csv");
  });

  it("names the PERIOD when the server gives none", () => {
    /*
      Not the id. A folder of `statement-01J8ZQ.csv` files is unsearchable, and
      an operator reconciling a quarter is looking for a week.
    */
    expect(statementFilename(null, week)).toBe(
      "yuvoy-statement-2026-09-08-to-2026-09-14.csv",
    );
    expect(statementFilename("attachment", week)).toBe(
      "yuvoy-statement-2026-09-08-to-2026-09-14.csv",
    );
  });

  it("REFUSES a server name carrying a path", () => {
    /*
      This string reaches a save dialog. A `Content-Disposition` carrying a path
      is how a download escapes the folder it was meant for, and the header is
      not ours.
    */
    for (const bad of [
      'attachment; filename="../../etc/passwd"',
      'attachment; filename="/etc/passwd"',
      'attachment; filename="..\\\\windows\\\\system32"',
      'attachment; filename=".."',
    ]) {
      expect(statementFilename(bad, week), bad).toBe(
        "yuvoy-statement-2026-09-08-to-2026-09-14.csv",
      );
    }
  });

  it("reads the RFC 5987 spelling too", () => {
    expect(
      statementFilename(
        "attachment; filename*=UTF-8''payout-2026-w37.csv",
        week,
      ),
    ).toBe("payout-2026-w37.csv");
  });
});
