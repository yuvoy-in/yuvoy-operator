/**
 * Times, in the MARKET's zone rather than the device's.
 *
 * Carried over from the traveller app because the failure is the same and it
 * is worse here: a 7am dive shown as 1:30am is a missed boat, and the person
 * reading this screen is the one standing beside the boat. The manifest gives
 * `startsAt` as an instant plus the departure's own `timezone`, so the zone is
 * never inferred.
 */

export function marketTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso));
}

export function marketDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(iso));
}

/** `YYYY-MM-DD` in the market's zone. What the slots endpoint filters on. */
export function marketDate(date: Date, timeZone = "Asia/Kolkata"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

/**
 * A bare `YYYY-MM-DD`, written the way an operator reads it.
 *
 * **Not an instant.** `OperatorCredential.expiresOn` is a date because "a
 * licence expires on a day, and sending a timestamp invites a timezone bug on
 * the one field an operator plans a season around" — so it is anchored to noon
 * in the market's zone before formatting. `new Date("2026-11-30")` parses as
 * UTC midnight, which is the previous evening in half the world; noon has no
 * such edge on either side.
 */
export function marketDateLabel(
  date: string,
  timeZone = "Asia/Kolkata",
): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(new Date(`${date}T12:00:00+05:30`));
}

/**
 * Whole days from today to a bare date, counted in the MARKET's calendar.
 *
 * Negative is the past. Counted between two calendar days rather than by
 * subtracting instants, for the reason `lastSeen` counts the same way: an
 * operator standing in Havelock at 03:00 is in a different UTC day, and
 * "expired yesterday" about a licence that is still valid is the kind of
 * wrong that gets a screen ignored.
 */
export function daysUntilMarketDate(date: string, now: number): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const then = Date.parse(`${date}T00:00:00+05:30`);
  if (Number.isNaN(then)) return null;
  const today = Date.parse(`${marketDate(new Date(now))}T00:00:00+05:30`);
  return Math.round((then - today) / 86_400_000);
}

/**
 * Whether a departure has set off yet.
 *
 * `completed` and `no_show` are refused by the API before the departure time
 * (409 `departure_has_not_started`), because "a trip that completed before it
 * left is a number no payout run can be trusted to have derived honestly".
 * The UI hides those buttons for the same reason rather than offering an
 * action that will be refused.
 */
export function hasDeparted(startsAt: string, now: number): boolean {
  return now >= new Date(startsAt).getTime();
}

/**
 * The clock, read outside a render path.
 *
 * `Date.now()` during render is impure and the React compiler refuses it —
 * server component or not. It is not pedantry: this screen re-renders on every
 * refresh, and a "has it departed yet" that flips between two renders of the
 * same request is a set of buttons that appears and disappears under a wet
 * thumb. Awaiting it puts the read in the async work, where a value is decided
 * once and passed down.
 */
export async function now(): Promise<number> {
  return Date.now();
}

/** Today and tomorrow in the market's zone, decided once per request. */
export async function marketDays(): Promise<{
  today: string;
  tomorrow: string;
}> {
  const t = await now();
  return {
    today: marketDate(new Date(t)),
    tomorrow: marketDate(new Date(t + 24 * 60 * 60 * 1000)),
  };
}

/**
 * What to call a day on the day screen.
 *
 * The UI only ever offers today and tomorrow, but the day arrives in a URL —
 * a link saved two days ago names a date that is neither, and captioning it
 * "Tomorrow" is a manifest lie on the screen the brief says must never
 * disagree with the boat. Anything else is named as the date it is.
 */
export function dayCaption(
  date: string,
  today: string,
  tomorrow: string,
  timeZone = "Asia/Kolkata",
): string {
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return marketDay(`${date}T12:00:00+05:30`, timeZone);
}
