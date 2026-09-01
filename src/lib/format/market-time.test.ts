import { describe, it, expect } from "vitest";
import { hasDeparted, marketDay, marketTime } from "./market-time";

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
