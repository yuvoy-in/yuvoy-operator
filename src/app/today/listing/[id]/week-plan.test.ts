import { describe, expect, it } from "vitest";
import type { ScheduleRow } from "./schedule-changes";
import {
  dropOwn,
  everyDay,
  giveOwn,
  planFromRows,
  planProblems,
  rowsFromPlan,
  setOwn,
  setUsual,
  sortRows,
  toggleDay,
  type WeekPlan,
} from "./week-plan";

const row = (weekday: number, startTime: string, seats = 8): ScheduleRow => ({
  weekday,
  startTime,
  seats,
});
const at = (startTime: string, seats = 8) => ({ startTime, seats });

/*
  yuvoy-operator#111. The week is picked (days, then a time and seats for all
  of them, then the days that are different) and sent as the one body
  `PUT /experiences/{id}/schedule` has always taken. These pin the two
  directions, because a schedule read back wrong is a departure dropped on
  the next save.
*/
describe("a schedule read into the picker", () => {
  it("starts a listing with none from a time and seats, and no days", () => {
    expect(planFromRows([])).toEqual({
      days: [],
      usual: [at("09:00", 8)],
      own: {},
    });
  });

  it("ticks the days that run and fills the one time they share", () => {
    expect(
      planFromRows([
        row(1, "07:00", 10),
        row(3, "07:00", 10),
        row(5, "07:00", 10),
      ]),
    ).toEqual({ days: [1, 3, 5], usual: [at("07:00", 10)], own: {} });
  });

  it("shows a day that differs as that day's own, a second departure included", () => {
    const plan = planFromRows([
      ...[1, 2, 3, 4, 5].map((day) => row(day, "09:00")),
      row(6, "09:00", 12),
      row(0, "15:00"),
      row(0, "07:00"),
    ]);
    expect(plan.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(plan.usual).toEqual([at("09:00")]);
    expect(plan.own).toEqual({
      6: [at("09:00", 12)],
      // Both of Sunday's, in the order they leave.
      0: [at("07:00"), at("15:00")],
    });
  });

  it("reads a boat that goes out twice every day as two usual times", () => {
    const rows = [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [
      row(day, "07:00", 8),
      row(day, "15:00", 6),
    ]);
    expect(planFromRows(rows)).toEqual({
      days: [0, 1, 2, 3, 4, 5, 6],
      usual: [at("07:00", 8), at("15:00", 6)],
      own: {},
    });
  });

  it("settles a tie on the week as it is read, Monday first", () => {
    // Sunday comes first in the API's order and last in a week as read.
    const plan = planFromRows([row(0, "10:00"), row(1, "09:00")]);
    expect(plan.usual).toEqual([at("09:00")]);
    expect(plan.own).toEqual({ 0: [at("10:00")] });
  });

  it("gives back exactly the rows it was given, in the API's order", () => {
    const schedules: ScheduleRow[][] = [
      [],
      [row(2, "09:00"), row(4, "09:00")],
      [row(5, "14:30", 6), row(2, "09:00")],
      [row(0, "15:00"), row(0, "07:00"), row(1, "07:00"), row(6, "09:00", 12)],
      [0, 1, 2, 3, 4, 5, 6].flatMap((day) => [
        row(day, "07:00"),
        row(day, "15:00"),
      ]),
    ];
    for (const rows of schedules) {
      expect(rowsFromPlan(planFromRows(rows))).toEqual(sortRows(rows));
    }
  });
});

describe("the picker, sent", () => {
  const plan: WeekPlan = {
    days: [1, 5, 0],
    usual: [at("09:00")],
    own: { 0: [at("15:00", 4), at("07:00", 4)], 3: [at("11:00")] },
  };

  it("is one row per day and time, a day's own instead of the usual", () => {
    expect(rowsFromPlan(plan)).toEqual([
      row(0, "07:00", 4),
      row(0, "15:00", 4),
      row(1, "09:00"),
      row(5, "09:00"),
    ]);
  });

  it("sends nothing for a day that does not run, whatever it holds", () => {
    // Wednesday's own departures are not sent: Wednesday is not ticked.
    expect(rowsFromPlan(plan).some((r) => r.weekday === 3)).toBe(false);
  });
});

describe("changing the week", () => {
  const base = planFromRows([row(2, "09:00"), row(4, "09:00")]);

  it("ticks a day onto the usual departures, and unticks it with its own", () => {
    const ticked = toggleDay(base, 1);
    expect(ticked.days).toEqual([1, 2, 4]);
    expect(rowsFromPlan(ticked)).toContainEqual(row(1, "09:00"));

    const different = giveOwn(ticked, 1);
    const unticked = toggleDay(different, 1);
    expect(unticked.days).toEqual([2, 4]);
    // Ticked again, it is back on the usual time, not the old own one.
    expect(unticked.own[1]).toBeUndefined();
  });

  it("ticks every day in one tap", () => {
    expect(everyDay(base).days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("starts a different day as a copy of the usual, so nothing is lost by asking", () => {
    const plan = giveOwn(base, 2);
    expect(plan.own[2]).toEqual([at("09:00")]);
    expect(rowsFromPlan(plan)).toEqual(rowsFromPlan(base));
    // Changing the copy changes that day only.
    const later = setOwn(plan, 2, [at("10:00")]);
    expect(rowsFromPlan(later)).toEqual([row(2, "10:00"), row(4, "09:00")]);
    // And back on the usual time.
    expect(rowsFromPlan(dropOwn(later, 2))).toEqual(rowsFromPlan(base));
  });

  it("never gives a day that does not run its own, or empties a list", () => {
    expect(giveOwn(base, 6)).toBe(base);
    expect(setUsual(base, [])).toBe(base);
    expect(setOwn(giveOwn(base, 2), 2, []).own[2]).toEqual([at("09:00")]);
    // A day with no own departures is not given an empty list.
    expect(setOwn(base, 2, [at("10:00")])).toBe(base);
  });
});

describe("what would be refused, said before it is sent", () => {
  const plan = (over: Partial<WeekPlan>): WeekPlan => ({
    days: [1],
    usual: [at("09:00")],
    own: {},
    ...over,
  });

  it("is nothing for a week the API takes", () => {
    expect(planProblems(plan({}))).toEqual([]);
    expect(planProblems(plan({ days: [] }))).toEqual([]);
  });

  it("asks for a time not yet picked, once, where it is", () => {
    expect(
      planProblems(plan({ usual: [at("09:00"), at(""), at("")] })),
    ).toEqual([{ day: null, message: "Pick a time for each departure." }]);
  });

  it("refuses one time twice on a day, and seats outside 1 to 200", () => {
    expect(
      planProblems(plan({ usual: [at("09:00"), at("09:00", 0)] })),
    ).toEqual([
      { day: null, message: "09:00 is listed twice." },
      { day: null, message: "Seats are 1 to 200." },
    ]);
    expect(planProblems(plan({ usual: [at("09:00", 201)] }))).toEqual([
      { day: null, message: "Seats are 1 to 200." },
    ]);
    expect(planProblems(plan({ usual: [at("09:00", NaN)] }))).toEqual([
      { day: null, message: "Seats are 1 to 200." },
    ]);
  });

  it("names the day for a day's own, and checks only what would be sent", () => {
    expect(
      planProblems(
        plan({
          days: [1, 0],
          own: { 0: [at("07:00"), at("07:00")], 3: [at("")] },
        }),
      ),
    ).toEqual([{ day: 0, message: "07:00 is listed twice." }]);
    // Every running day has its own: the usual departures are not sent.
    expect(
      planProblems(plan({ usual: [at("")], own: { 1: [at("08:00")] } })),
    ).toEqual([]);
  });
});
