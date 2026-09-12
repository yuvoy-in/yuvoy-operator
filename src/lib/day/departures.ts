/**
 * Adding departures — the arithmetic, kept pure so both sides can run it.
 *
 * `POST /slots` takes a date range, a list of times and an optional weekday
 * filter, and creates the cross product. That is a small formula with a large
 * consequence: an operator who means "next Saturday at seven" and leaves the
 * last day at the end of the fortnight creates **fourteen** departures, each
 * of which Yuvoy will sell.
 *
 * So the count is computed here, shown before the button is pressed, and
 * checked again in the Server Action against the same function. The form
 * cannot say one number and send another.
 *
 * ## Why the API's own leniency is not enough
 *
 * The endpoint is safe to press again — "dates that already have a departure
 * at that time are left alone, so `created: 0` is a legitimate answer and not
 * a failure". That protects against a double tap. It does not protect against
 * the operator meaning one departure and asking for fourteen, because from the
 * server's side those fourteen are exactly what was asked for.
 */

/** `0` is Sunday, as the contract has it. */
export const WEEKDAYS = [
  { value: 0, short: "Sun", label: "Sunday" },
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
] as const;

/** The contract's default, restated so the form and the body agree. */
export const DEFAULT_DURATION_MINUTES = 120;
export const DEFAULT_CUTOFF_HOURS = 4;

/**
 * How far ahead one press may schedule.
 *
 * Not in the contract — a guard of our own, and the reason is the cross
 * product above. A year of daily departures is 365 rows created by somebody
 * who left a date field alone, and every one of them is a boat Yuvoy would
 * sell seats on. Ninety days is a season, which is the longest thing anybody
 * plans in one sitting.
 */
export const MAX_RANGE_DAYS = 90;

/** And how many departures, however the range and times combine. */
export const MAX_DEPARTURES_PER_PRESS = 200;

export interface DeparturePlan {
  fromDate: string;
  /** Defaults to `fromDate` — "a single day need not be said twice". */
  toDate?: string;
  /** `HH:MM`, market time. One or more. */
  times: string[];
  /** Empty means every day in the range, which is what a one-off wants. */
  weekdays?: number[];
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Dates in the range that survive the weekday filter.
 *
 * Built in UTC on purpose. These are calendar dates, not instants: `2026-09-12`
 * is the twelfth wherever the operator is standing, and constructing them in
 * local time makes the weekday of a date near midnight depend on the phone's
 * timezone. A departure that lands on the wrong weekday because of where the
 * browser thinks it is would be the worst kind of quiet.
 */
export function departureDates(
  fromDate: string,
  toDate: string,
  weekdays: number[] = [],
): string[] {
  if (!DATE.test(fromDate) || !DATE.test(toDate)) return [];
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return [];

  const wanted = new Set(weekdays);
  const out: string[] = [];
  const DAY = 86_400_000;
  for (let t = start; t <= end; t += DAY) {
    const d = new Date(t);
    if (wanted.size && !wanted.has(d.getUTCDay())) continue;
    out.push(d.toISOString().slice(0, 10));
    // A malformed range cannot be allowed to spin. The count is refused above
    // this ceiling anyway; this only stops the loop reaching it.
    if (out.length > MAX_RANGE_DAYS + 1) break;
  }
  return out;
}

/** How many departures this plan would create. The number the operator sees. */
export function countDepartures(plan: DeparturePlan): number {
  const times = plan.times.filter((t) => TIME.test(t));
  if (!times.length) return 0;
  return (
    departureDates(plan.fromDate, plan.toDate ?? plan.fromDate, plan.weekdays)
      .length * times.length
  );
}

/**
 * Whether the plan is one worth sending, and what to say if not.
 *
 * Every branch is something the operator can act on. Nothing here duplicates a
 * rule the API owns — `created: 0` for dates that already have a departure is
 * the API's business and a legitimate answer, so it is not pre-empted.
 *
 * @param today The market's today, so "in the past" means the market's past
 *              rather than the phone's.
 */
export function departureProblem(
  plan: DeparturePlan,
  today: string,
): { field: string; message: string } | null {
  const to = plan.toDate ?? plan.fromDate;

  if (!DATE.test(plan.fromDate)) {
    return { field: "fromDate", message: "Pick the first day." };
  }
  if (!DATE.test(to)) {
    return { field: "toDate", message: "Pick the last day." };
  }
  if (to < plan.fromDate) {
    return {
      field: "toDate",
      message: "The last day cannot be before the first.",
    };
  }
  if (plan.fromDate < today) {
    return {
      field: "fromDate",
      message: "That day has gone. Departures start from today.",
    };
  }

  if (!plan.times.length) {
    return { field: "times", message: "Add at least one departure time." };
  }
  if (plan.times.some((t) => !TIME.test(t))) {
    return { field: "times", message: "Times look like 07:00." };
  }
  if (new Set(plan.times).size !== plan.times.length) {
    return {
      field: "times",
      message: "The same time is in the list twice. Remove one.",
    };
  }

  const days = departureDates(plan.fromDate, to).length;
  if (days > MAX_RANGE_DAYS) {
    return {
      field: "toDate",
      message: `That is ${days} days. Add up to ${MAX_RANGE_DAYS} at a time. A season is about as far ahead as anybody plans in one go.`,
    };
  }

  const count = countDepartures(plan);
  if (count === 0) {
    /*
      A range and times, but the weekday filter matched nothing in it — "every
      Saturday" over a Monday-to-Friday range. The API would answer
      `created: 0`, which is indistinguishable from "they already existed", so
      the difference is worth catching here where it can still be explained.
    */
    return {
      field: "weekdays",
      message:
        "No day in that range matches the days you picked, so there would be nothing to add. Widen the dates or pick more days.",
    };
  }
  if (count > MAX_DEPARTURES_PER_PRESS) {
    return {
      field: "times",
      message: `That would be ${count} departures in one go. Yuvoy sells a seat on every one of them, so do it in smaller batches, up to ${MAX_DEPARTURES_PER_PRESS} at a time.`,
    };
  }

  return null;
}

/** "3 departures" / "1 departure". Used in the preview and in the receipt. */
export function departureCount(n: number): string {
  return `${n} ${n === 1 ? "departure" : "departures"}`;
}
