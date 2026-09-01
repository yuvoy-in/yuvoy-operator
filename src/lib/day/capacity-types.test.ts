import { describe, it, expect } from "vitest";
import { MAX_SEATS, blackoutProblem, capacityProblem } from "./capacity-types";

/**
 * The floor under a seat count.
 *
 * "You cannot reduce a departure below what is already sold. Not 'should not'
 * — the database refuses it, because the alternative is a traveller with a
 * paid booking and no seat, discovered at a jetty at six in the morning."
 */
describe("capacityProblem", () => {
  it("refuses going below what is already sold", () => {
    expect(capacityProblem(3, 5)).toMatch(/already sold/);
    expect(capacityProblem(0, 1)).toMatch(/already sold/);
  });

  it("allows reducing to EXACTLY what is sold", () => {
    // That closes the departure without stranding anyone — the one reduction
    // the API permits, and the operator's way out of a full boat.
    expect(capacityProblem(5, 5)).toBeNull();
  });

  it("allows any increase, and zero when nothing is sold", () => {
    expect(capacityProblem(12, 5)).toBeNull();
    expect(capacityProblem(0, 0)).toBeNull();
  });

  it("holds the contract's own bounds", () => {
    expect(capacityProblem(MAX_SEATS, 0)).toBeNull();
    expect(capacityProblem(MAX_SEATS + 1, 0)).toMatch(/most a departure/);
    expect(capacityProblem(-1, 0)).toMatch(/negative/);
    expect(capacityProblem(1.5, 0)).toMatch(/whole number/);
  });

  it("names the number to type, not just the refusal", () => {
    // The contract asks clients to render its 409 copy verbatim "telling the
    // operator what to do instead". The local pre-check does the same.
    expect(capacityProblem(2, 6)).toContain("exactly 6");
  });
});

describe("blackoutProblem", () => {
  it("wants both dates, in the right order", () => {
    expect(blackoutProblem("2026-09-01", "2026-09-05")).toBeNull();
    expect(blackoutProblem("2026-09-01", "2026-09-01")).toBeNull();
    expect(blackoutProblem("2026-09-05", "2026-09-01")).toMatch(
      /before the first/,
    );
    expect(blackoutProblem("", "2026-09-01")).toMatch(/both dates/);
    expect(blackoutProblem("01-09-2026", "2026-09-05")).toMatch(/both dates/);
  });
});
