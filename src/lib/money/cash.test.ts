import { describe, it, expect } from "vitest";
import {
  canRecordAmount,
  compareToFare,
  fareComparisonText,
  rupeesToPaise,
} from "./cash";

/**
 * yuvoy-operator#40 §1. A collection is recorded once and never overwritten,
 * so the mis-key has to be visible while the box is open, not only in the
 * response that makes it permanent.
 */
describe("what somebody typed", () => {
  it("reads whole rupees the way people write them", () => {
    expect(rupeesToPaise("3000")).toBe(300_000);
    expect(rupeesToPaise("3,000")).toBe(300_000);
    expect(rupeesToPaise("₹ 3,000")).toBe(300_000);
    expect(rupeesToPaise("0")).toBe(0);
  });

  it("refuses what is not whole rupees rather than guessing", () => {
    for (const typed of ["", "3000.50", "-300", "3k", "12345678"]) {
      expect(rupeesToPaise(typed), typed).toBeNull();
    }
  });
});

describe("the sentence under the box", () => {
  const fare = 1_350_000; // ₹13,500

  it("says the gap in rupees before anything is recorded", () => {
    const c = compareToFare("3000", fare);
    expect(fareComparisonText(c)).toBe(
      "That is ₹10,500 less than the fare of ₹13,500.",
    );
    expect(canRecordAmount(c)).toBe(true);
  });

  it("refuses more than the fare, as the API does", () => {
    // "More than the fare is refused outright rather than trimmed."
    const c = compareToFare("14000", fare);
    expect(fareComparisonText(c)).toMatch(/more than the fare of ₹13,500/);
    expect(canRecordAmount(c)).toBe(false);
  });

  it("names the whole fare as the same act as one tap", () => {
    const c = compareToFare("13500", fare);
    expect(fareComparisonText(c)).toMatch(/whole fare/);
    expect(canRecordAmount(c)).toBe(true);
  });

  it("treats nothing taken as a real answer, said plainly", () => {
    const c = compareToFare("0", fare);
    expect(fareComparisonText(c)).toMatch(/nothing taken/);
    expect(canRecordAmount(c)).toBe(true);
  });

  it("offers nothing to record for an empty or garbled box", () => {
    expect(canRecordAmount(compareToFare("", fare))).toBe(false);
    expect(canRecordAmount(compareToFare("3k", fare))).toBe(false);
  });

  it("lets an amount through when the fare is unknown, and says to check it", () => {
    const c = compareToFare("3000", null);
    expect(canRecordAmount(c)).toBe(true);
    expect(fareComparisonText(c)).toMatch(/check this/);
  });

  it("never says 'paid'", () => {
    for (const typed of ["", "x", "0", "3000", "13500", "14000"]) {
      expect(
        fareComparisonText(compareToFare(typed, fare)).toLowerCase(),
      ).not.toContain("paid");
    }
  });
});
