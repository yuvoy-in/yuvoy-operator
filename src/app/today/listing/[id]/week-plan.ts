import type { ScheduleRow } from "./schedule-changes";

/**
 * A weekly schedule as the weekday picker holds it (yuvoy-operator#111).
 *
 * The form added one weekday at a time: a row with a day, a time and seats,
 * seven times over for a boat that runs every day, with nothing carried from
 * one row to the next. Product: "Instead of add a day it should be like
 * selection. Calendar wise. The current way is hectic." The API never asked
 * for rows one at a time: `PUT /experiences/{id}/schedule` takes "the whole
 * schedule" in one body.
 *
 * So the picker holds three things, and they say every schedule the contract
 * allows ("every weekday and time the listing runs, each at most once"):
 *
 *   - **`days`**, the weekdays that run, ticked as chips;
 *   - **`usual`**, the departures every one of those days has: one time and
 *     one seat count for most listings, and more than one for a boat that
 *     goes out twice a day;
 *   - **`own`**, the days that are the exception: departures of their own
 *     INSTEAD of the usual ones, a different time or different seats on one
 *     day.
 *
 * "Instead of", not "as well as", on purpose. A day given its own departures
 * starts with a copy of the usual ones, so changing its time changes that
 * day's departure rather than quietly adding a second one beside it, and
 * adding a second one is a separate, visible step.
 *
 * ## Read back without losing anything
 *
 * `planFromRows` is the inverse of `rowsFromPlan` for every schedule the API
 * can send: the usual departures are whatever most of the running days share,
 * and every other day keeps exactly its own. A second daily departure that
 * already exists comes back as a second usual time, or as that day's own,
 * never dropped. `week-plan.test.ts` pins the round trip.
 */

/** One departure of the week: when it leaves, and how many it takes. */
export interface Departure {
  startTime: string;
  seats: number;
}

export interface WeekPlan {
  /** Weekdays that run, 0 (Sunday) to 6 (Saturday), ascending. */
  days: number[];
  /** What every day that runs has, unless it has its own. Never empty. */
  usual: Departure[];
  /** Days with departures of their own instead of the usual ones. */
  own: Partial<Record<number, Departure[]>>;
}

/** What a new schedule starts from: the old form's first row, minus the day. */
export const FIRST_DEPARTURE: Departure = { startTime: "09:00", seats: 8 };

/** The order a week is read in, and the chips drawn: Monday first. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** "Mon" for 1: the chip's word. Its name is the whole day. */
export const SHORT_DAY = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

const TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** By weekday from Sunday, then by time: the order the API reads them back. */
export function sortRows(rows: readonly ScheduleRow[]): ScheduleRow[] {
  return [...rows].sort(
    (a, b) =>
      a.weekday - b.weekday ||
      a.startTime.localeCompare(b.startTime) ||
      a.seats - b.seats,
  );
}

function byTime(departures: readonly Departure[]): Departure[] {
  return [...departures].sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.seats - b.seats,
  );
}

const signature = (departures: readonly Departure[]) =>
  departures.map((d) => `${d.startTime}|${d.seats}`).join(",");

/** The schedule a listing has, as the picker shows it. */
export function planFromRows(rows: readonly ScheduleRow[]): WeekPlan {
  const byDay = new Map<number, Departure[]>();
  for (const row of rows) {
    const day = byDay.get(row.weekday) ?? [];
    day.push({ startTime: row.startTime, seats: row.seats });
    byDay.set(row.weekday, day);
  }
  const days = [...byDay.keys()].sort((a, b) => a - b);
  if (days.length === 0) {
    return { days: [], usual: [{ ...FIRST_DEPARTURE }], own: {} };
  }

  /*
    The usual departures are what the most days share. A tie goes to the
    earliest day in the week as it is read, Monday first, so the same schedule
    always reads back the same way.
  */
  const counts = new Map<string, number>();
  for (const day of days) {
    const key = signature(byTime(byDay.get(day)!));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let usualDay = days[0];
  let best = -1;
  for (const day of WEEK_ORDER) {
    if (!byDay.has(day)) continue;
    const count = counts.get(signature(byTime(byDay.get(day)!)))!;
    if (count > best) {
      best = count;
      usualDay = day;
    }
  }
  const usual = byTime(byDay.get(usualDay)!);
  const usualKey = signature(usual);

  const own: WeekPlan["own"] = {};
  for (const day of days) {
    const departures = byTime(byDay.get(day)!);
    if (signature(departures) !== usualKey) own[day] = departures;
  }
  return { days, usual, own };
}

/** The body `PUT /experiences/{id}/schedule` takes: the whole week. */
export function rowsFromPlan(plan: WeekPlan): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  for (const day of plan.days) {
    for (const d of plan.own[day] ?? plan.usual) {
      rows.push({ weekday: day, startTime: d.startTime, seats: d.seats });
    }
  }
  return sortRows(rows);
}

/** Something that would make the API refuse the week, and where it is. */
export interface PlanProblem {
  /** The day whose own departures it is in, or `null` for the usual ones. */
  day: number | null;
  message: string;
}

/**
 * What would make the API refuse this week, found before it is sent: a time
 * that is not a time, seats outside 1 to 200, and one time twice on a day
 * ("each at most once"). The words are the ones the save already uses. Only
 * what a running day would send is checked, and each problem is said once
 * where it is, not once per row.
 */
export function planProblems(plan: WeekPlan): PlanProblem[] {
  const problems: PlanProblem[] = [];
  const check = (day: number | null, departures: readonly Departure[]) => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    let noTime = false;
    let badTime = false;
    let badSeats = false;
    for (const d of departures) {
      if (d.startTime === "") noTime = true;
      else if (!TIME.test(d.startTime)) badTime = true;
      else if (seen.has(d.startTime)) twice.add(d.startTime);
      seen.add(d.startTime);
      if (!Number.isInteger(d.seats) || d.seats < 1 || d.seats > 200) {
        badSeats = true;
      }
    }
    if (noTime) {
      problems.push({ day, message: "Pick a time for each departure." });
    }
    if (badTime) problems.push({ day, message: "Times look like 07:00." });
    for (const time of twice) {
      problems.push({ day, message: `${time} is listed twice.` });
    }
    if (badSeats) problems.push({ day, message: "Seats are 1 to 200." });
  };
  if (plan.days.some((day) => !plan.own[day])) check(null, plan.usual);
  for (const day of WEEK_ORDER) {
    const departures = plan.own[day];
    if (departures && plan.days.includes(day)) check(day, departures);
  }
  return problems;
}

/* --------------------------------------------------------- the changes -- */

/** Tick or untick a day. Unticked, it keeps no departures of its own. */
export function toggleDay(plan: WeekPlan, day: number): WeekPlan {
  if (plan.days.includes(day)) {
    const own = { ...plan.own };
    delete own[day];
    return { ...plan, days: plan.days.filter((d) => d !== day), own };
  }
  return { ...plan, days: [...plan.days, day].sort((a, b) => a - b) };
}

/** Every day of the week ticked, each keeping what it had. */
export function everyDay(plan: WeekPlan): WeekPlan {
  return { ...plan, days: [0, 1, 2, 3, 4, 5, 6] };
}

/** The usual departures, replaced. Never left empty. */
export function setUsual(plan: WeekPlan, usual: Departure[]): WeekPlan {
  return usual.length === 0 ? plan : { ...plan, usual };
}

/**
 * One day given departures of its own, starting as a copy of the usual ones,
 * so nothing that day had is lost by asking for it to be different.
 */
export function giveOwn(plan: WeekPlan, day: number): WeekPlan {
  if (!plan.days.includes(day) || plan.own[day]) return plan;
  return {
    ...plan,
    own: { ...plan.own, [day]: plan.usual.map((d) => ({ ...d })) },
  };
}

/** A day's own departures, replaced. Never left empty. */
export function setOwn(
  plan: WeekPlan,
  day: number,
  departures: Departure[],
): WeekPlan {
  if (departures.length === 0 || !plan.own[day]) return plan;
  return { ...plan, own: { ...plan.own, [day]: departures } };
}

/** A day back on the usual departures. */
export function dropOwn(plan: WeekPlan, day: number): WeekPlan {
  if (!plan.own[day]) return plan;
  const own = { ...plan.own };
  delete own[day];
  return { ...plan, own };
}
