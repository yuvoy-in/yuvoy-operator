import { describe, it, expect } from "vitest";
import {
  dayCaption,
  deadlineLabel,
  hasDeparted,
  marketDay,
  marketTime,
} from "./market-time";

/**
 * Times in the market's zone.
 *
 * "A 7am dive shown as 1:30am is a missed boat" — and the person reading this
 * screen is the one standing beside the boat.
 */
describe("market time", () => {
  // 06:45 IST on 18 August 2026.
  const DAWN = "2026-08-18T01:15:00Z";

  it("renders a departure in the market's zone, not the device's", () => {
    expect(marketTime(DAWN, "Asia/Kolkata")).toBe("06:45");
    // The same instant, elsewhere. Proof the zone is used and not ignored.
    expect(marketTime(DAWN, "UTC")).toBe("01:15");
  });

  it("uses 24-hour time", () => {
    // 15:30 IST. "3:30 pm" invites a misread in bright sun; a boat schedule
    // is written in 24-hour time everywhere else on the dock too.
    expect(marketTime("2026-08-18T10:00:00Z", "Asia/Kolkata")).toBe("15:30");
  });

  it("names the day in the market's zone", () => {
    // 00:30 IST on the 19th is still the 18th in UTC — the zone decides which
    // day an operator is told they are running.
    const justAfterMidnightIST = "2026-08-18T19:00:00Z";
    expect(marketDay(justAfterMidnightIST, "Asia/Kolkata")).toContain("19");
    expect(marketDay(justAfterMidnightIST, "UTC")).toContain("18");
  });

  it("says a departure has set off only once it actually has", () => {
    const t = new Date(DAWN).getTime();
    expect(hasDeparted(DAWN, t - 1)).toBe(false);
    // Exactly on the minute counts as departed: the API's own refusal is
    // `now >= startsAt`, and a UI that disagrees offers a button that 409s.
    expect(hasDeparted(DAWN, t)).toBe(true);
    expect(hasDeparted(DAWN, t + 1)).toBe(true);
  });
});

describe("dayCaption", () => {
  it("names today and tomorrow, and any other day as the date it is", () => {
    expect(dayCaption("2026-08-18", "2026-08-18", "2026-08-19")).toBe("Today");
    expect(dayCaption("2026-08-19", "2026-08-18", "2026-08-19")).toBe(
      "Tomorrow",
    );
    // A stale bookmark. Used to read "Tomorrow" over yesterday's departures.
    expect(dayCaption("2026-08-17", "2026-08-18", "2026-08-19")).toBe(
      "Monday, 17 August",
    );
  });
});

describe("a deadline as an operator chases it: yuvoy-operator#95", () => {
  // 20:00 IST on Mon 21 Sep 2026.
  const EVENING = Date.parse("2026-09-21T14:30:00Z");

  it("is a bare time when it falls on the market's today", () => {
    // 23:10 IST the same day.
    expect(deadlineLabel("2026-09-21T17:40:00Z", "Asia/Kolkata", EVENING)).toBe(
      "23:10",
    );
  });

  it("names the day when it falls on another", () => {
    // 08:00 IST the next morning: the twelve-hour hold's usual shape.
    expect(deadlineLabel("2026-09-22T02:30:00Z", "Asia/Kolkata", EVENING)).toBe(
      "08:00 on Tue 22 Sep",
    );
  });

  it("reads the day in the market, not in UTC", () => {
    // 00:30 IST on the 22nd is still the 21st in UTC.
    expect(deadlineLabel("2026-09-21T19:00:00Z", "Asia/Kolkata", EVENING)).toBe(
      "00:30 on Tue 22 Sep",
    );
  });

  it("is empty for an instant it cannot read", () => {
    expect(deadlineLabel("soon", "Asia/Kolkata", EVENING)).toBe("");
  });
});
