import type { BookingLine } from "@/lib/money/bookings";
import { marketDate, marketTime } from "@/lib/format/market-time";
import type { OperatorSlot } from "./types";

/**
 * The calendar's fourteen days — yuvoy-operator#45.
 *
 * "Today plus the next thirteen days. Per-day: date label, a closed badge
 * when applicable, the count of unique start times, and the number of
 * confirmed guests." Pure, so where a boat's departure lands, and what a day
 * says about the people already on it, can be proved without a server.
 *
 * ## Calendar controls sellable capacity; Bookings owns obligations
 *
 * The rule under the whole screen, and the issue asks for it in a comment:
 * closing a day stops new sales and cancels nobody. Everything the calendar
 * says about people already booked points at Bookings rather than offering to
 * resolve them here.
 */

/** Today and the next thirteen days. */
export const CALENDAR_DAYS = 14;

/** A `YYYY-MM-DD` shifted by whole days. Built in UTC, as bare dates are. */
export function shiftDay(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** The calendar's days, as market dates, starting today. */
export function calendarDays(today: string, count = CALENDAR_DAYS): string[] {
  return Array.from({ length: count }, (_, i) => shiftDay(today, i));
}

/**
 * The window to ASK the API for, to be sure of every departure on a run of
 * market days.
 *
 * `GET /slots` and `GET /bookings` read `from` and `to` as UTC days — `from`
 * is UTC midnight and `to` runs to the next one (yuvoy-api
 * `operator_platform.go`, `operator.go`) — while every day an operator sees is
 * the market's. A 05:00 IST departure is 23:30 UTC the evening before, so
 * asking for its own day misses it, and tomorrow's would turn up tonight. A
 * day of margin either side covers any market within a day of UTC; the answer
 * is then cut back to the days that were meant (`inMarketDays`).
 */
export function apiWindow(
  from: string,
  to: string,
): { from: string; to: string } {
  return { from: shiftDay(from, -1), to: shiftDay(to, 1) };
}

/** The market date an instant falls on, in its own zone — or null if unreadable. */
export function marketDayOf(iso: string, timeZone: string): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  return marketDate(new Date(iso), timeZone);
}

/** Only the rows whose own market day is inside `[from, to]`. */
export function inMarketDays<T extends { startsAt?: string; timezone: string }>(
  rows: readonly T[],
  from: string,
  to: string,
): T[] {
  return rows.filter((row) => {
    const day = marketDayOf(row.startsAt ?? "", row.timezone);
    return day !== null && day >= from && day <= to;
  });
}

/** One day's departures, first-off-first as the list already is. */
export function departuresOn(
  slots: readonly OperatorSlot[],
  day: string,
): OperatorSlot[] {
  return inMarketDays(slots, day, day);
}

/** A called-off departure is not a boat that leaves. */
function running(departures: readonly OperatorSlot[]): OperatorSlot[] {
  return departures.filter((s) => s.status !== "cancelled");
}

/**
 * How many different times boats leave that day — the demo's count, which is
 * not the number of departures: two listings leaving at 09:00 are one start
 * time and two departures.
 */
export function startTimeCount(departures: readonly OperatorSlot[]): number {
  return new Set(
    running(departures).map((s) => marketTime(s.startsAt, s.timezone)),
  ).size;
}

/** Seats sold across the day's departures that are still running. */
export function soldOn(departures: readonly OperatorSlot[]): number {
  return running(departures).reduce((n, s) => n + s.sold, 0);
}

/**
 * Whether the whole day is closed to new bookings.
 *
 * Every departure still running is `closed` — the status `POST /blackouts`
 * sets. A called-off departure is `cancelled`, a different and heavier act,
 * and neither it nor an empty day makes a day read as closed.
 */
export function isClosedDay(departures: readonly OperatorSlot[]): boolean {
  const live = running(departures);
  return live.length > 0 && live.every((s) => s.status === "closed");
}

/** The most rows `GET /bookings` returns. It sends no cursor past them. */
export const BOOKINGS_PAGE = 100;

/** A booking that is a promise already made. */
const CONFIRMED = new Set(["confirmed", "paid_pending_ops"]);

/**
 * Guests already confirmed on each day — or `null` when that cannot be known.
 *
 * `GET /bookings` returns at most 100 rows and no cursor, so a full page may be
 * a cut-short one. A count that quietly lost the last bookings would be the
 * number in the one sentence on this screen that has to be true — "4 guests
 * are already confirmed" — so a full page, like a failed read, is "not known"
 * rather than a smaller number.
 *
 * `paid_pending_ops` counts: a traveller paying at the counter sits in it
 * until the cash is recorded, and closing the day moves them no more than
 * anybody else.
 */
export function confirmedGuestsByDay(
  bookings: readonly BookingLine[] | null,
  days: readonly string[],
): Map<string, number> | null {
  if (bookings === null || bookings.length >= BOOKINGS_PAGE) return null;
  const counts = new Map(days.map((day) => [day, 0]));
  for (const booking of bookings) {
    if (!CONFIRMED.has(booking.state.trim().toLowerCase())) continue;
    const day = marketDayOf(booking.startsAt ?? "", booking.timezone);
    if (day !== null && counts.has(day)) {
      counts.set(day, (counts.get(day) ?? 0) + booking.guests);
    }
  }
  return counts;
}

/**
 * The first of the issue's two sentences, verbatim.
 *
 * "An operator who closes a day believing it cancelled the bookings does not
 * turn up, and the people who paid are standing on a jetty."
 */
export const CLOSING_SENTENCE =
  "Closing stops new bookings straight away. Bookings you've already confirmed stay live. Resolve those one by one in Bookings.";

/** The second, verbatim — "4 guests are already confirmed. …" */
export function alreadyConfirmedSentence(guests: number): string {
  const who = guests === 1 ? "1 guest is" : `${guests} guests are`;
  return `${who} already confirmed. Closing won't move them. Resolve each booking in Bookings.`;
}
