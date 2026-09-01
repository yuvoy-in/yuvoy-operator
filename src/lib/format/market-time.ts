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
