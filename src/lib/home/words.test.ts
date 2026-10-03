import { describe, expect, it } from "vitest";
import { count, dayWords, daysBetween, shortDate } from "./words";

describe("the words Home is written in", () => {
  it("counts in the singular and the plural", () => {
    expect(count(1, "departure", "departures")).toBe("1 departure");
    expect(count(0, "departure", "departures")).toBe("0 departures");
    expect(count(12, "departure", "departures")).toBe("12 departures");
  });

  it("names a date the way a phone and a server both spell it", () => {
    /*
      Fixed tables, not Intl: node spells September "Sept" and a browser
      "Sep", and a line written on one side must read the same on the other.
    */
    expect(shortDate("2026-09-28")).toBe("Mon 28 Sep");
    expect(shortDate("2026-10-03")).toBe("Sat 3 Oct");
    expect(shortDate("not a date")).toBe("");
  });

  it("says a day as it is said on the day", () => {
    const today = "2026-09-22"; // a Tuesday
    expect(dayWords("2026-09-22", today)).toBe("today");
    expect(dayWords("2026-09-23", today)).toBe("tomorrow");
    expect(dayWords("2026-09-26", today)).toBe("Sat");
    // A week out, the weekday alone would be ambiguous.
    expect(dayWords("2026-09-29", today)).toBe("Tue 29 Sep");
    expect(daysBetween("2026-09-22", "2026-10-01")).toBe(9);
  });
});
