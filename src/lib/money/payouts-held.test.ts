import { describe, expect, expectTypeOf, it } from "vitest";
import {
  PAYOUT_HOLD_REASONS,
  heldDestinationLine,
  payoutsHeldNotice,
  toPayoutsHeld,
  type PayoutHoldReason,
} from "./payouts-held";
import { SUPPORT_PHONE } from "@/lib/site/contact";

/*
  yuvoy-operator#156. Money named the bank account on the next payout while
  the payout run was holding it for the second reason, a new account our team
  had not yet put into the bank we pay from: "To your bank: HDFC0001234 ·
  account ending 4412" over money that was not going anywhere.
*/

describe("payoutsHeld, as it enters", () => {
  it("keeps the two reasons the API gives", () => {
    expect(
      toPayoutsHeld({ held: true, reason: "bank_change_in_progress" }),
    ).toBe("bank_change_in_progress");
    expect(
      toPayoutsHeld({ held: true, reason: "destination_unconfirmed" }),
    ).toBe("destination_unconfirmed");
  });

  it("is nothing held when the API says so", () => {
    expect(toPayoutsHeld({ held: false, reason: null })).toBeNull();
  });

  it("reads a reason this build does not know as held, never as free", () => {
    expect(toPayoutsHeld({ held: true, reason: "bank_audit" })).toBe("other");
    expect(toPayoutsHeld({ held: true, reason: null })).toBe("other");
    expect(toPayoutsHeld({ held: true })).toBe("other");
  });

  it("reads a body that contradicts itself as held", () => {
    /*
      The contract makes `held` true exactly when `reason` is set. Saying the
      money is coming when the run will refuse it is the worse mistake.
    */
    expect(
      toPayoutsHeld({ held: false, reason: "destination_unconfirmed" }),
    ).toBe("destination_unconfirmed");
    expect(toPayoutsHeld({ held: false, reason: "bank_audit" })).toBe("other");
  });

  it("is unknown, and so not held, from an API that does not send it", () => {
    // Before yuvoy-api#275: the screens fall back to the change list alone.
    expect(toPayoutsHeld(undefined)).toBeNull();
    expect(toPayoutsHeld(null)).toBeNull();
    expect(toPayoutsHeld("held")).toBeNull();
    expect(toPayoutsHeld({ held: false, reason: "  " })).toBeNull();
  });

  it("lists every reason the contract declares, and no other", () => {
    expect(PAYOUT_HOLD_REASONS).toEqual([
      "bank_change_in_progress",
      "destination_unconfirmed",
    ]);
    /*
      Checked by the typechecker: a third reason added to the contract and
      missing here fails `pnpm typecheck` on this line, and `satisfies` on the
      list refuses one the contract does not have.
    */
    expectTypeOf<
      (typeof PAYOUT_HOLD_REASONS)[number]
    >().toEqualTypeOf<PayoutHoldReason>();
  });
});

describe("the To your bank row while payouts are held", () => {
  it("names no account, and says why, for each reason", () => {
    expect(heldDestinationLine(false, "destination_unconfirmed")).toBe(
      "On hold until we update our bank",
    );
    expect(heldDestinationLine(false, "bank_change_in_progress")).toBe(
      "On hold until your bank change settles",
    );
    expect(heldDestinationLine(false, "other")).toBe("On hold");
  });

  it("holds on the change list alone, as before, when /me says nothing", () => {
    expect(heldDestinationLine(true, null)).toBe(
      "On hold until your bank change settles",
    );
  });

  it("holds when either side says so", () => {
    expect(heldDestinationLine(true, "other")).toBe(
      "On hold until your bank change settles",
    );
    expect(heldDestinationLine(true, "destination_unconfirmed")).toBe(
      "On hold until we update our bank",
    );
  });

  it("names the account only when nothing holds the payout", () => {
    expect(heldDestinationLine(false, null)).toBeNull();
  });
});

describe("what Payout details says about a hold", () => {
  it("says the second hold, which no change on screen can", () => {
    const notice = payoutsHeldNotice("destination_unconfirmed", {
      changeShown: false,
    });
    expect(notice?.title).toBe("Payouts are on hold until we update our bank");
    expect(notice?.body).toMatch(/Nothing is needed from you/);
    // Said even beside a change: the change does not explain this hold.
    expect(
      payoutsHeldNotice("destination_unconfirmed", { changeShown: true }),
    ).toEqual(notice);
  });

  it("leaves a bank change to its own panel when one is on screen", () => {
    expect(
      payoutsHeldNotice("bank_change_in_progress", { changeShown: true }),
    ).toBeNull();
    expect(
      payoutsHeldNotice("bank_change_in_progress", { changeShown: false })
        ?.title,
    ).toBe("Payouts are on hold while your bank change goes through");
  });

  it("gives a reason it does not know to a person who does", () => {
    expect(payoutsHeldNotice("other", { changeShown: false })).toEqual({
      title: "Payouts are on hold",
      body: `Call us on ${SUPPORT_PHONE} and we will tell you why.`,
    });
  });

  it("says nothing when nothing is held", () => {
    expect(payoutsHeldNotice(null, { changeShown: false })).toBeNull();
  });
});
