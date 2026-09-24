/**
 * What saving a weekly schedule would close (the audit before release, O2).
 *
 * `PUT /experiences/{id}/schedule`: "Removing a weekday and time closes what
 * this schedule made at it. Every departure still to come that this schedule
 * made at a weekday and time the save removes ... is closed to new bookings
 * ... Closing cancels nobody: the bookings on those departures stand." And
 * "Changing a time's seats changes no departure already made."
 *
 * So a row whose day or time changed is a time removed (and another added),
 * and a row whose seats changed removes nothing. Only removing EVERY row asked
 * first; a save that dropped Tuesday 09:00 closed a season of Tuesdays with no
 * question at all.
 */

export interface ScheduleRow {
  weekday: number;
  startTime: string;
  seats: number;
}

/** Weekday names, Sunday first, as the rows number them. */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const key = (row: ScheduleRow) => `${row.weekday}|${row.startTime}`;

/** The weekdays and times the schedule had that the rows no longer have. */
export function removedTimes(
  before: readonly ScheduleRow[],
  after: readonly ScheduleRow[],
): ScheduleRow[] {
  const kept = new Set(after.map(key));
  const seen = new Set<string>();
  return before.filter((row) => {
    const k = key(row);
    if (kept.has(k) || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** "Tuesdays at 09:00". */
function when(row: ScheduleRow): string {
  const day = WEEKDAYS[row.weekday] ?? "That day";
  return `${day}s at ${row.startTime}`;
}

/**
 * What the confirm says: which departures stop taking new bookings, and that
 * the people on them stay. Only what the contract says happens.
 */
export function closingSentence(removed: readonly ScheduleRow[]): string {
  const times = removed.map(when);
  const list =
    times.length <= 1
      ? (times[0] ?? "")
      : `${times.slice(0, -1).join(", ")} and ${times[times.length - 1]}`;
  return `Departures it made on ${list} stop taking new bookings. Bookings already on them stay.`;
}
