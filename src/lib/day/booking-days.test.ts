import { describe, it, expect } from "vitest";
import type { BookingLine } from "@/lib/money/bookings";
import { byMarketDay, mostRecentFirst, uniqueById } from "./booking-days";

const line = (over: Partial<BookingLine> = {}): BookingLine => ({
  id: "b1",
  reference: "YV-4K2M9P7Q",
  name: "Asha Menon",
  guests: 2,
  experience: "Try-dive at Nemo Reef",
  startsAt: "2026-09-11T03:30:00Z",
  timezone: "Asia/Kolkata",
  state: "confirmed",
  ...over,
});

describe("confirmed bookings, by the day they run — yuvoy-operator#43", () => {
  it("groups by the market's day, with the totals the demo prints", () => {
    const groups = byMarketDay([
      // 05:00 on the 11th is 23:30 UTC on the 10th.
      line({ id: "a", guests: 2, startsAt: "2026-09-10T23:30:00Z" }),
      line({ id: "b", guests: 3, startsAt: "2026-09-11T08:30:00Z" }),
      line({ id: "c", guests: 1, startsAt: "2026-09-12T03:30:00Z" }),
    ]);
    expect(
      groups.map((g) => [g.day, g.bookings.map((b) => b.id), g.guests]),
    ).toEqual([
      ["2026-09-11", ["a", "b"], 5],
      ["2026-09-12", ["c"], 1],
    ]);
  });

  it("keeps a booking with no readable time, at the end, rather than losing it", () => {
    const groups = byMarketDay([
      line({ id: "x", startsAt: undefined }),
      line({ id: "y" }),
    ]);
    expect(groups.map((g) => g.day)).toEqual(["2026-09-11", ""]);
    expect(groups[1].bookings.map((b) => b.id)).toEqual(["x"]);
  });
});

describe("the past, most recent first", () => {
  it("puts the latest trip at the top, and one with no time last", () => {
    expect(
      mostRecentFirst([
        line({ id: "old", startsAt: "2026-09-01T03:30:00Z" }),
        line({ id: "none", startsAt: undefined }),
        line({ id: "new", startsAt: "2026-09-09T03:30:00Z" }),
      ]).map((b) => b.id),
    ).toEqual(["new", "old", "none"]);
  });

  it("lists a booking once when two reads overlap", () => {
    expect(
      uniqueById(
        [line({ id: "a" }), line({ id: "b" })],
        [line({ id: "b" }), line({ id: "c" })],
      ).map((b) => b.id),
    ).toEqual(["a", "b", "c"]);
  });
});
