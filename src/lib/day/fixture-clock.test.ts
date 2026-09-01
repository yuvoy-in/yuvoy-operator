import { describe, it, expect, afterEach, vi } from "vitest";
import { hasDeparted } from "@/lib/format/market-time";

/**
 * The e2e suite depends on two fixture departures having opposite answers to
 * "has it set off yet", and for a long time both were wall-clock literals.
 *
 * `slot_dawn` was pinned to 06:45, so every test that needs it to have
 * departed was red between midnight and quarter to seven — nobody noticed,
 * because nobody runs the suite then. Its counterpart was pinned to 23:30 and
 * went red at 23:30, which is how this was found: the pre-push gate refused a
 * push at 23:36 on a change that had nothing to do with it.
 *
 * A test asserting the invariant *now* would have caught the 23:36 failure and
 * missed the 03:00 one. So the clock is moved instead, and the fixtures are
 * re-imported at each hour — which is the only way to assert a property that
 * is about every hour rather than about this one.
 */
async function slotsAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  vi.resetModules();
  const { SLOTS } = await import("../../../mocks/fixtures");
  const find = (id: string) => SLOTS.find((s) => s.id === id)!;
  return { departed: find("slot_dawn"), upcoming: find("slot_late_morning") };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("the fixture day, at every hour of the fixture day", () => {
  const hours = [
    "2026-09-01T00:00:00+05:30", // the stroke of midnight
    "2026-09-01T00:00:01+05:30",
    "2026-09-01T03:00:00+05:30", // the window that was silently red
    "2026-09-01T06:44:00+05:30",
    "2026-09-01T12:00:00+05:30",
    "2026-09-01T23:29:00+05:30",
    "2026-09-01T23:36:00+05:30", // the minute that caught it
    "2026-09-01T23:59:59+05:30",
  ];

  for (const iso of hours) {
    it(`holds at ${iso.slice(11, 19)} IST`, async () => {
      vi.useFakeTimers();
      const now = new Date(iso).getTime();
      const { departed, upcoming } = await slotsAt(iso);

      expect(hasDeparted(departed.startsAt, now)).toBe(true);
      expect(hasDeparted(upcoming.startsAt, now)).toBe(false);
    });
  }

  it("keeps the departed one inside today, so the day screen still lists it", async () => {
    /*
      `/today` filters `from=today&to=today`. A departed fixture that slid into
      yesterday would vanish from the list the manifest test clicks through.
    */
    vi.useFakeTimers();
    const iso = "2026-09-01T00:30:00+05:30";
    const { departed } = await slotsAt(iso);

    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
    }).format(new Date(departed.startsAt));
    expect(day).toBe("2026-09-01");
  });
});
