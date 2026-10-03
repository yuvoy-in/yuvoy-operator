import { describe, it, expect } from "vitest";
import { payoutDestination, payoutHold, type ChangeRequest } from "./earnings";

/**
 * What is left of the earnings helpers (yuvoy-operator#47 item 8).
 *
 * The month picker over `GET /earnings` went with the owner's 14 September
 * decision, and `canStillMove`, `describeState`, `monthRange` and `reconciles`
 * went with it: a calendar month was never the unit money moves in, so every
 * figure that screen derived was one no transfer ever matched.
 *
 * `payoutHold` survives because it reads a DIFFERENT endpoint,
 * `GET /change-requests`, and answers a question the new screen still asks: a
 * payout held while somebody checks a change of bank details is money that is
 * owed and not moving, which changes what every figure above it means.
 */

describe("payoutHold", () => {
  const req = (over: Partial<ChangeRequest>): ChangeRequest =>
    ({
      id: "c1",
      kind: "bank_account",
      state: "cooling",
      ...over,
    }) as ChangeRequest;

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

/*
  The bank inside the payout (operator A, approved 3 Oct 2026). The account is
  said only when money is going to it, and never while a bank change could
  still send it somewhere else.
*/
describe("where the next payout goes", () => {
  const LINE = "HDFC0001234 · account ending 4412";

  it("names the account on file when the week pays", () => {
    expect(payoutDestination(4_015_000, LINE, false)).toEqual({
      kind: "account",
      line: LINE,
    });
  });

  it("names no account while a bank change is in flight", () => {
    expect(payoutDestination(4_015_000, LINE, true)).toEqual({ kind: "held" });
    // Even with nothing on file: the hold is the fact that matters.
    expect(payoutDestination(4_015_000, null, true)).toEqual({ kind: "held" });
  });

  it("says nothing when nothing is sent", () => {
    expect(payoutDestination(-50_000, LINE, false)).toBeNull();
    expect(payoutDestination(0, LINE, false)).toBeNull();
    expect(payoutDestination(-50_000, LINE, true)).toBeNull();
    expect(payoutDestination(Number.NaN, LINE, false)).toBeNull();
  });

  it("claims nothing for an account set up by hand", () => {
    expect(payoutDestination(4_015_000, null, false)).toBeNull();
  });
});
