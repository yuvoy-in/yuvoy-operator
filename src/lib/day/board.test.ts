import { describe, expect, it } from "vitest";
import type { OperatorListing, OperatorSlot } from "./types";
import type { Closure } from "./closures";
import {
  boardHref,
  boardRows,
  occupancyLine,
  readDay,
  readWeek,
  weekDays,
  weekLine,
  weekStartOf,
  WEEKS_EITHER_SIDE,
} from "./board";

const TODAY = "2026-10-08"; // a Thursday
const NOW = Date.parse("2026-10-08T00:30:00Z"); // 06:00 in the market

const slot = (over: Partial<OperatorSlot>): OperatorSlot => ({
  id: "s1",
  title: "Try-dive",
  experienceId: "exp_dive",
  // 09:00 on Thu 8 Oct in the market.
  startsAt: "2026-10-08T03:30:00Z",
  timezone: "Asia/Kolkata",
  seats: 8,
  sold: 5,
  remaining: 3,
  status: "open",
  bookingMode: "allotment",
  onSale: true,
  ...over,
});

const listing = (over: Partial<OperatorListing>): OperatorListing => ({
  id: "exp_dive",
  title: "Try-dive",
  status: "live",
  ...over,
});

describe("the board's week", () => {
  it("starts on the Monday of the week a day is in", () => {
    expect(weekStartOf("2026-10-08")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05");
    // A Sunday belongs to the week that started six days before.
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05");
  });

  it("is seven market days, Monday first, across a month's end", () => {
    expect(weekDays("2026-09-28")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("reads any week from the address, back as well as forward", () => {
    // Last week: yesterday's departures can be closed out (audit 5.1).
    expect(readWeek("2026-10-01", TODAY)).toBe("2026-09-28");
    // A month out: a departure three weeks away can be changed.
    expect(readWeek("2026-11-12", TODAY)).toBe("2026-11-09");
  });

  it("falls back to this week for a week it cannot or should not show", () => {
    for (const raw of [undefined, "", "soon", "2026-13-40", ["2026-10-01"]]) {
      expect(readWeek(raw, TODAY), String(raw)).toBe("2026-10-05");
    }
    const tooFar = new Date(
      Date.parse("2026-10-05T00:00:00Z") +
        (WEEKS_EITHER_SIDE + 1) * 7 * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    expect(readWeek(tooFar, TODAY)).toBe("2026-10-05");
  });

  it("opens on today when today is in the week, else on its Monday", () => {
    const days = weekDays("2026-10-05");
    expect(readDay(undefined, days, TODAY)).toBe(TODAY);
    expect(readDay("2026-10-10", days, TODAY)).toBe("2026-10-10");
    // A day the week does not hold is not trusted.
    expect(readDay("2026-10-20", days, TODAY)).toBe(TODAY);
    expect(readDay(undefined, weekDays("2026-10-12"), TODAY)).toBe(
      "2026-10-12",
    );
  });
});

describe("the board's rows", () => {
  const days = weekDays("2026-10-05");

  it("draws each listing by day, with the departure in the words of the day", () => {
    const rows = boardRows({
      listings: [listing({})],
      slots: [slot({})],
      past: null,
      closures: [],
      days,
      waiting: new Map([["s1", 2]]),
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    const thursday = rows[0].days.find((d) => d.day === "2026-10-08");
    expect(thursday?.departures).toEqual([
      {
        id: "s1",
        time: "09:00",
        title: "Try-dive",
        people: 5,
        seats: 8,
        chip: null,
        calledOff: false,
        departed: false,
        closed: false,
        waiting: 2,
      },
    ]);
    expect(rows[0].days.filter((d) => d.departures.length > 0)).toHaveLength(1);
  });

  it("keeps a live or paused listing with nothing this week, and drops a draft", () => {
    const rows = boardRows({
      listings: [
        listing({ id: "a", title: "A live one" }),
        listing({ id: "p", title: "A paused one", status: "withdrawn" }),
        listing({ id: "d", title: "A draft", status: "draft" }),
      ],
      slots: [],
      past: null,
      closures: [],
      days,
      waiting: new Map(),
      now: NOW,
    });
    expect(rows.map((r) => r.listingId)).toEqual(["a", "p"]);
  });

  it("never drops a departure whose listing the read did not return", () => {
    const rows = boardRows({
      listings: null,
      slots: [slot({ experienceId: "exp_gone", title: "Old boat" })],
      past: null,
      closures: [],
      days,
      waiting: new Map(),
      now: NOW,
    });
    expect(rows.map((r) => r.title)).toEqual(["Old boat"]);
  });

  it("says called off in the calendar's word, and keeps what has left", () => {
    const rows = boardRows({
      listings: [listing({})],
      slots: [
        slot({ id: "off", status: "cancelled" }),
        slot({ id: "gone", startsAt: "2026-10-07T03:30:00Z" }),
      ],
      past: null,
      closures: [],
      days,
      waiting: new Map(),
      now: NOW,
    });
    const all = rows[0].days.flatMap((d) => d.departures);
    expect(all.find((d) => d.id === "off")).toMatchObject({
      chip: { label: "Called off", loud: false },
      calledOff: true,
    });
    // Yesterday's boat is still on the board, so its day can be closed out.
    expect(all.find((d) => d.id === "gone")).toMatchObject({
      departed: true,
    });
  });

  it("marks a closed day, a closed listing and a closed departure", () => {
    const closures: Closure[] = [
      {
        id: "c1",
        from: "2026-10-06",
        to: "2026-10-06",
        reasonCode: "MAINTENANCE",
        departureIds: [],
      },
      {
        id: "c2",
        from: "2026-10-08",
        to: "2026-10-08",
        reasonCode: "WEATHER",
        experienceId: "exp_dive",
        departureIds: ["s1"],
      },
    ];
    const rows = boardRows({
      listings: [listing({})],
      slots: [slot({})],
      past: null,
      closures,
      days,
      waiting: new Map(),
      now: NOW,
    });
    expect(rows[0].days.find((d) => d.day === "2026-10-06")?.closed).toBe(true);
    expect(
      rows[0].days.find((d) => d.day === "2026-10-08")?.departures[0].closed,
    ).toBe(true);
  });
});

describe("what the board can honestly say about selling", () => {
  it("is seats sold of seats offered, counter sales included, over departures that ran", () => {
    expect(
      occupancyLine([
        slot({ seats: 8, sold: 6 }),
        // Two sold at the counter are taken off `seats` and are not in `sold`.
        slot({ seats: 6, sold: 2, soldOffline: 2 }),
        // Called off: not a departure that ran.
        slot({ seats: 8, sold: 0, status: "cancelled" }),
      ]),
    ).toBe("Last 4 weeks: 63% of seats sold");
  });

  it("says nothing rather than 0% when there was nothing to sell", () => {
    expect(occupancyLine([])).toBeNull();
    expect(occupancyLine([slot({ seats: 0, sold: 0 })])).toBeNull();
  });

  it("sums the week, leaving out what was called off", () => {
    expect(
      weekLine([
        slot({ seats: 8, sold: 5 }),
        slot({ seats: 10, sold: 10 }),
        slot({ seats: 8, sold: 0, status: "cancelled" }),
      ]),
    ).toBe("15 of 18 seats sold");
    expect(weekLine([])).toBeNull();
  });
});

describe("the board's address", () => {
  it("is plain for this week, on today", () => {
    expect(boardHref({ week: "2026-10-05" }, TODAY)).toBe("/calendar");
    expect(boardHref({ week: "2026-10-05", day: TODAY }, TODAY)).toBe(
      "/calendar",
    );
  });

  it("names another week, another day and an open departure", () => {
    expect(
      boardHref({ week: "2026-10-12", day: "2026-10-14", dep: "s9" }, TODAY),
    ).toBe("/calendar?week=2026-10-12&day=2026-10-14&dep=s9");
    // Another week's Monday is that week's own default day.
    expect(boardHref({ week: "2026-10-12", day: "2026-10-12" }, TODAY)).toBe(
      "/calendar?week=2026-10-12",
    );
  });
});
