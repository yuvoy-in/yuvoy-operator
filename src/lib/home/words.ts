/**
 * The small words Home is written in: counts, days and clocks.
 *
 * Fixed English tables rather than `Intl` for every day and month name. The
 * same locale spells September "Sept" in node's ICU and "Sep" in a browser's,
 * and a line written on the server must read the same once a client
 * component takes it over (the traveller app learned this as a hydration
 * mismatch). Only the clock, `marketTime`, goes through `Intl`, and it has no
 * words in it.
 */

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "1 departure", "3 departures". */
export function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Whole days from one market date to another, both `YYYY-MM-DD`. */
export function daysBetween(from: string, to: string): number | null {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** "Mon 28 Sep", for a bare market date. Empty for one that does not parse. */
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // The weekday of a calendar date, which no time zone can move.
  const weekday = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
  return `${WEEKDAY[weekday]} ${d} ${MONTH[mo - 1]}`;
}

/**
 * A market date as a person says it on the day: "today", "tomorrow", the
 * weekday inside the coming week ("Sat"), and the date past that
 * ("Sat 3 Oct"). Lower case, because it sits inside a line.
 */
export function dayWords(date: string, today: string): string {
  const ahead = daysBetween(today, date);
  if (ahead === 0) return "today";
  if (ahead === 1) return "tomorrow";
  const full = shortDate(date);
  if (ahead !== null && ahead > 1 && ahead < 7) return full.split(" ")[0];
  return full;
}

/**
 * How long is left to answer a request, from the server's own
 * `minutesToAnswer`: "answer within 24 min", "answer within 1h 20m",
 * "answer within 2 days". Never re-derived from `expiresAt` on this side, so
 * every screen says the same clock.
 */
export function answerWithin(minutes: number | undefined): string {
  const m = Math.floor(minutes ?? 0);
  if (m <= 0) return "out of time to answer";
  if (m < 60) return `answer within ${m} min`;
  if (m < 24 * 60) {
    const hours = Math.floor(m / 60);
    const rest = m % 60;
    return `answer within ${hours}h${rest ? ` ${rest}m` : ""}`;
  }
  return `answer within ${count(Math.floor(m / (24 * 60)), "day", "days")}`;
}
