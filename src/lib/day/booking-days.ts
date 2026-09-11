import type { BookingLine } from "@/lib/money/bookings";
import { marketDayOf } from "./calendar";

/**
 * Bookings, arranged the way the demo's Confirmed and Past views read —
 * yuvoy-operator#43.
 *
 * Pure, so the grouping an operator reads their week from can be proved
 * without a server: which day a 05:00 boat belongs to, what each day adds up
 * to, and that nothing falls off the list because a field was missing.
 */

export interface BookingDay {
  /** `YYYY-MM-DD` in the market's calendar, or `""` for a booking with no readable time. */
  day: string;
  bookings: BookingLine[];
  /** Guests across the day's bookings — the demo's "summarised as total bookings and guests". */
  guests: number;
}

/**
 * Confirmed bookings grouped by the MARKET day the trip runs, earliest day
 * first, each day's bookings in the order they came.
 *
 * A booking with no readable time is kept, in a group of its own at the end,
 * rather than dropped off the operator's list: a booking nobody can see is a
 * traveller nobody meets.
 */
export function byMarketDay(bookings: readonly BookingLine[]): BookingDay[] {
  const groups = new Map<string, BookingDay>();
  for (const booking of bookings) {
    const day = marketDayOf(booking.startsAt ?? "", booking.timezone) ?? "";
    const group = groups.get(day) ?? { day, bookings: [], guests: 0 };
    group.bookings.push(booking);
    group.guests += booking.guests;
    groups.set(day, group);
  }
  return [...groups.values()].sort((a, b) =>
    a.day === "" ? 1 : b.day === "" ? -1 : a.day.localeCompare(b.day),
  );
}

/** The past, most recent trip first — "reverse-chronological". Undated last. */
export function mostRecentFirst(
  bookings: readonly BookingLine[],
): BookingLine[] {
  const when = (b: BookingLine) =>
    b.startsAt ? Date.parse(b.startsAt) : Number.NaN;
  return [...bookings].sort((a, b) => {
    const ta = when(a);
    const tb = when(b);
    if (Number.isNaN(ta)) return Number.isNaN(tb) ? 0 : 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
}

/**
 * Two reads of overlapping windows, as one list with each booking once.
 *
 * The windows overlap by design — each is asked for a day wider than it means,
 * because the API's dates are UTC days — so the same booking can come back
 * from both.
 */
export function uniqueById(
  ...lists: (readonly BookingLine[])[]
): BookingLine[] {
  const seen = new Set<string>();
  const out: BookingLine[] = [];
  for (const list of lists) {
    for (const booking of list) {
      const key = booking.id || `${booking.reference}|${booking.startsAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(booking);
    }
  }
  return out;
}
