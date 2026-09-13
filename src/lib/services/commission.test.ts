import { describe, it, expect } from "vitest";
import { commissionPreview, formatRate } from "./commission";

/**
 * "You receive ₹3,825" — yuvoy-operator#44.
 *
 * The rate had to come from the API. Hardcoding 15% was refused on 11
 * September because a business on its own negotiated rate would have been
 * shown a number that was wrong about its own money.
 */
describe("commissionPreview", () => {
  it("splits a fare at the business's own rate", () => {
    // ₹4,500 at 15%: ₹675 to Yuvoy, ₹3,825 to the business.
    expect(commissionPreview(450_000, 1500)).toEqual({
      feePaise: 67_500,
      receivePaise: 382_500,
    });
  });

  it("rounds once, at the end, in paise", () => {
    /*
      A percentage taken in rupees and multiplied back is off by up to a paisa
      per booking, and a preview that disagrees with the settlement by a paisa
      invites a conversation about whether we can count.

      ₹333.33 at 15% is 4,999.95 paise.
    */
    expect(commissionPreview(33_333, 1500)).toEqual({
      feePaise: 5_000,
      receivePaise: 28_333,
    });
  });

  it("always splits the fare exactly, with nothing lost or invented", () => {
    // The property that matters more than any single figure.
    for (const price of [1, 99, 100, 33_333, 450_000, 999_999]) {
      for (const bps of [0, 1, 1500, 3333, 10_000]) {
        const split = commissionPreview(price, bps)!;
        expect(split.feePaise + split.receivePaise, `${price}@${bps}`).toBe(
          price,
        );
      }
    }
  });

  it("shows nothing rather than a flattering lie when there is no rate", () => {
    /*
      "Absent where the service was not given a standard rate." A missing rate
      is not a rate of zero, and rendering the whole fare as received would be
      the most flattering possible wrong answer.
    */
    expect(commissionPreview(450_000, undefined)).toBeNull();
    expect(commissionPreview(450_000, null)).toBeNull();
  });

  it("shows nothing when there is no price to split", () => {
    // A listing can be saved without one.
    expect(commissionPreview(null, 1500)).toBeNull();
    expect(commissionPreview(0, 1500)).toBeNull();
  });

  it("refuses a rate outside nought to a hundred per cent", () => {
    // Not reachable from the API. A negative rate renders a business
    // receiving more than the traveller paid; over 100% renders less than
    // nothing.
    expect(commissionPreview(450_000, -1)).toBeNull();
    expect(commissionPreview(450_000, 10_001)).toBeNull();
    expect(commissionPreview(450_000, 1500.5)).toBeNull();
  });
});

describe("formatRate", () => {
  it("reads as a percentage, not as basis points", () => {
    expect(formatRate(1500)).toBe("15%");
    expect(formatRate(0)).toBe("0%");
    expect(formatRate(10_000)).toBe("100%");
  });

  it("keeps a fractional rate rather than rounding it away", () => {
    // A business on 12.5% must not be told 13%.
    expect(formatRate(1250)).toBe("12.5%");
  });
});
