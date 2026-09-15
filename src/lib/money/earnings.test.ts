import { describe, it, expect } from "vitest";
import { payoutHold, type ChangeRequest } from "./earnings";

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
