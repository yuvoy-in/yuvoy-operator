import { peopleOn } from "@/lib/home/day";
import { isLive } from "@/lib/home/listings";
import { hasDeparted, marketTime } from "@/lib/format/market-time";
import { departuresOn, shiftDay } from "./calendar";
import {
  listingClosures,
  departureClosures,
  wholeDayClosures,
  type Closure,
} from "./closures";
import { saleChip } from "./off-sale";
import type { OperatorListing, OperatorSlot } from "./types";

/**
 * The Calendar as a board: every listing by day, any week (operator
 * experiment B's board, approved 3 Oct 2026 as the Calendar; audit 5.1).
 *
 * The fortnight it replaces had no way past today plus thirteen days, so
 * yesterday could not be closed out and a departure three weeks away could
 * not have its seats changed or be called off. The API takes any range; the
 * board reads one week at a time and pages by week, back and forward.
 *
 * Pure: the week is worked out from market dates (bare `YYYY-MM-DD`, built in
 * UTC as `shiftDay` does) and every word a cell says from the departure, so
 * the board's rules are tested without a server.
 */

/** How far either side of today the board pages: a season, and a stop. */
export const WEEKS_EITHER_SIDE = 60;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function weekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday of the week a market day is in. */
export function weekStartOf(day: string): string {
  return shiftDay(day, -((weekday(day) + 6) % 7));
}

/** The week's seven market days, Monday first. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => shiftDay(start, i));
}

/**
 * The week a URL asks for, as its Monday: this week when it asks for none,
 * for a date that does not parse, or for one outside the pages either side.
 */
export function readWeek(raw: unknown, today: string): string {
  const here = weekStartOf(today);
  if (typeof raw !== "string" || !DATE.test(raw)) return here;
  if (Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) return here;
  const start = weekStartOf(raw);
  const weeks = Math.round(
    (Date.parse(`${start}T00:00:00Z`) - Date.parse(`${here}T00:00:00Z`)) /
      (7 * 86_400_000),
  );
  return Math.abs(weeks) > WEEKS_EITHER_SIDE ? here : start;
}

/** The day a URL asks for inside the week, or the first sensible one. */
export function readDay(
  raw: unknown,
  days: readonly string[],
  today: string,
): string {
  if (typeof raw === "string" && days.includes(raw)) return raw;
  return days.includes(today) ? today : days[0];
}

/** One departure in a cell. */
export interface BoardDeparture {
  id: string;
  /** "07:00". */
  time: string;
  title: string;
  /** Everybody on it: sold through Yuvoy and at the counter. */
  people: number;
  /** Everybody it can take, counter sales included. */
  seats: number;
  /**
   * The calendar's own word when it is not simply selling: "Called off",
   * "Closed", "Full", "Not on sale" (`saleChip`), loud when it is a lost sale.
   */
  chip: { label: string; loud: boolean } | null;
  calledOff: boolean;
  /** Already left: kept on the board, so its day can be closed out. */
  departed: boolean;
  /** A closure in force shuts this departure, or its listing that day. */
  closed: boolean;
  /** Seat requests waiting on an answer for it. */
  waiting: number;
}

export interface BoardDay {
  day: string;
  /** A whole-day closure in force. */
  closed: boolean;
  departures: BoardDeparture[];
}

export interface BoardRow {
  listingId: string;
  title: string;
  days: BoardDay[];
  /** "Last 4 weeks: 71% of seats sold", or null with nothing to say. */
  occupancy: string | null;
}

export function boardDeparture(
  slot: OperatorSlot,
  closures: readonly Closure[],
  day: string,
  waiting: ReadonlyMap<string, number>,
  now: number,
): BoardDeparture {
  const calledOff = slot.status === "cancelled";
  const closed =
    !calledOff &&
    (departureClosures(closures, slot.id).length > 0 ||
      listingClosures(closures, day).some(
        (c) => c.experienceId === slot.experienceId,
      ));
  return {
    id: slot.id,
    time: marketTime(slot.startsAt, slot.timezone),
    title: slot.title,
    people: peopleOn(slot),
    seats: slot.seats + (slot.soldOffline ?? 0),
    chip: saleChip(slot),
    calledOff,
    departed: hasDeparted(slot.startsAt, now),
    closed,
    waiting: waiting.get(slot.id) ?? 0,
  };
}

/**
 * Seats sold of seats offered, over departures that ran: what the board can
 * say honestly about how a listing sells. The contract has no views, plays or
 * conversion (audit section 7), so this is the only analytic, and it says
 * where it comes from.
 */
export function occupancyLine(past: readonly OperatorSlot[]): string | null {
  let seats = 0;
  let people = 0;
  for (const slot of past) {
    if (slot.status === "cancelled" || slot.seats <= 0) continue;
    seats += slot.seats + (slot.soldOffline ?? 0);
    people += peopleOn(slot);
  }
  if (seats === 0) return null;
  return `Last 4 weeks: ${Math.round((people / seats) * 100)}% of seats sold`;
}

/** "38 of 54 seats sold" over the week's departures not called off. */
export function weekLine(slots: readonly OperatorSlot[]): string | null {
  const running = slots.filter((s) => s.status !== "cancelled");
  if (running.length === 0) return null;
  const seats = running.reduce((n, s) => n + s.seats + (s.soldOffline ?? 0), 0);
  const people = running.reduce((n, s) => n + peopleOn(s), 0);
  return `${people} of ${seats} seats sold`;
}

/**
 * The board's rows: one per listing that sells, is paused, or has something
 * in the week, in the order the listings read returns them (by title), and a
 * departure whose listing that read did not return still gets a row under its
 * own title rather than disappearing.
 */
export function boardRows(input: {
  listings: readonly OperatorListing[] | null;
  slots: readonly OperatorSlot[];
  past: readonly OperatorSlot[] | null;
  closures: readonly Closure[];
  days: readonly string[];
  /** Waiting requests per departure id. */
  waiting: ReadonlyMap<string, number>;
  now: number;
}): BoardRow[] {
  const { listings, slots, past, closures, days, waiting, now } = input;
  const order: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const listing of listings ?? []) {
    const has = slots.some((s) => s.experienceId === listing.id);
    // Live, or paused (`withdrawn`): both have a week worth drawing.
    const shown =
      isLive({ status: listing.status, sentBack: Boolean(listing.sentBack) }) ||
      listing.status === "withdrawn";
    if (!has && !shown) continue;
    order.push({ id: listing.id, title: listing.title });
    seen.add(listing.id);
  }
  for (const slot of slots) {
    const id = slot.experienceId ?? `untitled:${slot.title}`;
    if (seen.has(id)) continue;
    order.push({ id, title: slot.title });
    seen.add(id);
  }

  return order.map(({ id, title }) => {
    const mine = slots.filter(
      (s) => (s.experienceId ?? `untitled:${s.title}`) === id,
    );
    return {
      listingId: id,
      title,
      occupancy: past
        ? occupancyLine(past.filter((s) => s.experienceId === id))
        : null,
      days: days.map((day) => ({
        day,
        closed: wholeDayClosures(closures, day).length > 0,
        departures: departuresOn(mine, day).map((slot) =>
          boardDeparture(slot, closures, day, waiting, now),
        ),
      })),
    };
  });
}

/**
 * The board's address for a week, a day in it, and an open departure.
 *
 * The board's whole state is the URL, so Back, a refresh and a link pasted
 * into a message all land on the same week, day and inspector. The week is
 * left out when it is this week and the day when it is the week's own
 * default, so the plain `/calendar` stays the plain address.
 */
export function boardHref(
  state: { week: string; day?: string; dep?: string },
  today: string,
): string {
  const params = new URLSearchParams();
  const thisWeek = weekStartOf(today);
  if (state.week !== thisWeek) params.set("week", state.week);
  const fallback = readDay(undefined, weekDays(state.week), today);
  if (state.day && state.day !== fallback) params.set("day", state.day);
  if (state.dep) params.set("dep", state.dep);
  const query = params.toString();
  return query ? `/calendar?${query}` : "/calendar";
}
