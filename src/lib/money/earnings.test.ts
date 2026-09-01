import { describe, it, expect } from "vitest";
import {
  canStillMove,
  describeState,
  monthRange,
  payoutHold,
  reconciles,
  type ChangeRequest,
  type Earnings,
  type EarningsState,
} from "./earnings";

const base: Earnings = {
  bookings: 12,
  grossPaise: 5_400_000,
  commissionPaise: 810_000,
  refundsPaise: 450_000,
  netPaise: 4_140_000,
  state: "provisional",
};

/**
 * The two questions an operator brings to this screen: *is this final*, and
 * *does it add up*.
 */
describe("earnings", () => {
  it("checks the arithmetic rather than trusting the total", () => {
    // A reconciliation screen that cannot reconcile is worse than no screen.
    expect(reconciles(base)).toBe(true);
    expect(reconciles({ ...base, netPaise: 4_140_001 })).toBe(false);
    expect(reconciles({ ...base, commissionPaise: 0 })).toBe(false);
  });

  it("warns only on the states that can still move", () => {
    // "Nobody should plan against a number that can still move."
    expect(canStillMove("provisional")).toBe(true);
    expect(canStillMove("open")).toBe(true);
    for (const s of ["locked", "approved", "exported", "settled", "void"]) {
      expect(canStillMove(s as EarningsState)).toBe(false);
    }
  });

  it("has a plain sentence for every state the contract can return", () => {
    /*
      A state with no copy renders as nothing, which reads as "no information"
      on the one screen that is entirely about information. Asserted as "is a
      sentence, and is not just the state name echoed back" rather than a
      length threshold — the first version of this used `.length > 10` and
      failed on "Paid.", which was a fine sentence and a bad assertion.
    */
    const all: EarningsState[] = [
      "provisional",
      "open",
      "locked",
      "approved",
      "exported",
      "settled",
      "void",
    ];
    for (const s of all) {
      const copy = describeState(s);
      expect(copy, s).toMatch(/\.$/);
      expect(copy.toLowerCase(), s).not.toBe(s);
      expect(copy.split(" ").length, s).toBeGreaterThan(1);
    }
  });
});

describe("payoutHold", () => {
  const req = (over: Partial<ChangeRequest>): ChangeRequest =>
    ({ id: "c1", kind: "bank", state: "cooling", ...over }) as ChangeRequest;

  it("holds while a bank change is anywhere before applied", () => {
    const holding = ["objection_window", "pending", "cooling"] as const;
    for (const state of holding) {
      expect(payoutHold([req({ state })]), state).not.toBeNull();
    }
  });

  it("does not hold once it is live, or if it never happened", () => {
    // `applied` means the new account IS the account — payouts resume to it.
    const done = ["applied", "rejected", "withdrawn"] as const;
    for (const state of done) {
      expect(payoutHold([req({ state })]), state).toBeNull();
    }
    expect(payoutHold([])).toBeNull();
  });

  it("ignores a change request that is not about the bank", () => {
    // Only money movement is held by a bank change; a profile edit is not.
    expect(payoutHold([req({ kind: "profile", state: "cooling" })])).toBeNull();
  });
});

describe("monthRange", () => {
  // 15 September 2026, 06:00 UTC — 11:30 IST, comfortably mid-month.
  const mid = new Date("2026-09-15T06:00:00Z").getTime();

  it("covers a whole calendar month", () => {
    expect(monthRange(0, mid)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(monthRange(1, mid)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("crosses a year boundary", () => {
    const jan = new Date("2026-01-10T06:00:00Z").getTime();
    expect(monthRange(1, jan)).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("uses the market's month, not the runner's", () => {
    // 31 Aug 23:00 UTC is already 1 September in Asia/Kolkata, so "this
    // month" must be September. A payout period on the wrong side of a month
    // boundary is a reconciliation that never balances.
    const boundary = new Date("2026-08-31T23:00:00Z").getTime();
    expect(monthRange(0, boundary).from).toBe("2026-09-01");
  });
});
