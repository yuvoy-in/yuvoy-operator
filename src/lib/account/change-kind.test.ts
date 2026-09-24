import { describe, expect, it } from "vitest";
import {
  BANK_CHANGE,
  CHANGE_KINDS,
  toChangeKind,
  toChangeRequest,
} from "./change-kind";
import { payoutHold } from "@/lib/money/earnings";

/*
  The bank change the portal could never find (23 Sep 2026).

  The API writes `bank_account`; Payout details and Earnings looked for `bank`
  from O4 (1 Sep) on, and the mock wrote `bank` too, so every test passed over
  a screen that showed no change in flight, and so no Stop, in production.
*/

describe("a change request's kind, as it enters", () => {
  it("keeps the kinds the API writes", () => {
    expect(toChangeKind("bank_account")).toBe("bank_account");
    expect(toChangeKind("logo")).toBe("logo");
    expect(toChangeKind("profile")).toBe("profile");
  });

  it("reads a kind it does not know as other, never as a bank change", () => {
    expect(toChangeKind("bank")).toBe("other");
    expect(toChangeKind("")).toBe("other");
    expect(toChangeKind(undefined)).toBe("other");
    expect(toChangeKind(7)).toBe("other");
  });

  it("changes nothing else on the row", () => {
    const raw = {
      id: "chg_1",
      kind: "bank_account",
      state: "cooling" as const,
      summary: "HDFC Bank ••••4417 · HDFC0001234",
      requestedAt: "2026-09-22T03:30:00Z",
      objectionUntil: null,
      coolingUntil: "2026-09-24T03:30:00Z",
    };
    expect(toChangeRequest(raw)).toEqual(raw);
  });

  it("names the bank change the way the database does", () => {
    // operator_change_requests_kind_check, yuvoy-api migration 0064.
    expect(BANK_CHANGE).toBe("bank_account");
    expect(CHANGE_KINDS).toEqual([
      "bank_account",
      "profile",
      "logo",
      "contact",
      "capacity",
      "listing",
    ]);
  });
});

describe("a payout held for a bank change", () => {
  it("is found when the API's own kind comes back", () => {
    const held = payoutHold([
      toChangeRequest({ id: "logo_1", kind: "logo", state: "pending" }),
      toChangeRequest({ id: "chg_1", kind: "bank_account", state: "cooling" }),
    ]);
    expect(held?.id).toBe("chg_1");
  });

  it("is not found for a kind the API never writes", () => {
    expect(
      payoutHold([
        toChangeRequest({ id: "x", kind: "bank", state: "cooling" }),
      ]),
    ).toBeNull();
  });
});

describe("the mock", () => {
  it("writes only kinds the API writes, so a test cannot pass on a made-up one", async () => {
    const { CHANGE_REQUESTS } = await import("../../../mocks/fixtures");
    for (const r of CHANGE_REQUESTS) {
      expect(CHANGE_KINDS as readonly string[]).toContain(r.kind);
    }
  });
});
