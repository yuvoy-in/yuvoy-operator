import { describe, expect, it } from "vitest";
import { answerWithin, count, dayWords, daysBetween, shortDate } from "./words";

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

  it("says the clock on a request from the server's own minutes", () => {
    expect(answerWithin(24)).toBe("answer within 24 min");
    expect(answerWithin(80)).toBe("answer within 1h 20m");
    expect(answerWithin(120)).toBe("answer within 2h");
    expect(answerWithin(1_805)).toBe("answer within 1 day");
    expect(answerWithin(3 * 24 * 60)).toBe("answer within 3 days");
    // Never negative on the wire, and never a negative clock on screen.
    expect(answerWithin(0)).toBe("out of time to answer");
    expect(answerWithin(undefined)).toBe("out of time to answer");
  });
});
