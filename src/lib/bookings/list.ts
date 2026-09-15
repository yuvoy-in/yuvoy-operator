import type { BookingLine } from "@/lib/money/bookings";
import { marketDayOf } from "@/lib/day/calendar";

/**
 * The Bookings screen's own rules — yuvoy-operator#57.
 *
 * ## The server answers the search, and that is the whole point
 *
 * "Search, filters and counts run on the server (D-036), so they stay right at
 * any number of bookings." A portal that filtered the rows it happened to load
 * would answer a different question every time the page size changed, and its
 * pill counts would be counts of a page.
 *
 * The one exception is the Requests pill, and it is an exception because
 * requests are not bookings: they come from `GET /requests`, which takes no
 * search. So they are filtered here, by the same three rules the API applies to
 * `counts.requests` — and by NAME only, because "a request has no reference".
 */

export const VIEWS = ["requests", "upcoming", "past", "cancelled"] as const;
export type View = (typeof VIEWS)[number];

/**
 * The pill a URL asks for, or `null` for "decide from the counts".
 *
 * "Any other value is treated as absent" rather than refused: this arrives in a
 * URL somebody may have edited or a link somebody kept, and a 400 screen for a
 * typo in a query string is worse than the default pill.
 */
export function readView(raw: string | undefined): View | null {
  return (VIEWS as readonly string[]).includes(raw ?? "")
    ? (raw as View)
    : null;
}

/** The API's own ceiling. Longer is a `400` with `details.q`. */
export const MAX_SEARCH = 60;

/** What to send as `q`: trimmed, and never longer than the API will take. */
export function readSearch(raw: string | undefined): string {
  return (raw ?? "").trim().slice(0, MAX_SEARCH);
}

export interface Filters {
  q: string;
  experienceId: string;
  from: string;
  to: string;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The four filters a URL carries, each dropped when it is not usable. */
export function readFilters(params: {
  q?: string;
  experienceId?: string;
  from?: string;
  to?: string;
}): Filters {
  const from = DATE.test(params.from ?? "") ? params.from! : "";
  const to = DATE.test(params.to ?? "") ? params.to! : "";
  return {
    q: readSearch(params.q),
    experienceId: (params.experienceId ?? "").trim(),
    /*
      A range that runs backwards is dropped whole rather than half-sent. The
      API answers `400` on neither field alone, and a screen that kept `from`
      would quietly show a different range from the one in the control.
    */
    ...(from && to && to < from ? { from: "", to: "" } : { from, to }),
  };
}

/** Whether anything is narrowing the list. Decides whether Clear is drawn. */
export function anyFilter(filters: Filters): boolean {
  return Boolean(
    filters.q || filters.experienceId || filters.from || filters.to,
  );
}

export type DateChoice = "any" | "today" | "tomorrow" | "next7" | "pick";

/** The five options, in the issue's order. */
export const DATE_CHOICES: { value: DateChoice; label: string }[] = [
  { value: "any", label: "Any date" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "next7", label: "Next 7 days" },
  { value: "pick", label: "Pick dates" },
];

/** A `YYYY-MM-DD` shifted by whole days, built in UTC as bare dates are. */
function shift(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** What a named choice sends as `from` and `to`. */
export function datesFor(
  choice: DateChoice,
  today: string,
  tomorrow: string,
): { from: string; to: string } {
  switch (choice) {
    case "today":
      return { from: today, to: today };
    case "tomorrow":
      return { from: tomorrow, to: tomorrow };
    case "next7":
      // Today plus six: seven days counted inclusively, which is what "next 7
      // days" means to somebody planning a week.
      return { from: today, to: shift(today, 6) };
    default:
      return { from: "", to: "" };
  }
}

/**
 * Which named choice a pair of dates IS, so the control comes back as the
 * operator left it.
 *
 * Derived rather than stored in the URL beside the dates: two sources for one
 * fact drift, and the dates are the half the API reads. A range that matches no
 * named option is "Pick dates", which is exactly what it was.
 */
export function choiceFor(
  filters: Filters,
  today: string,
  tomorrow: string,
): DateChoice {
  if (!filters.from && !filters.to) return "any";
  for (const named of ["today", "tomorrow", "next7"] as const) {
    const dates = datesFor(named, today, tomorrow);
    if (dates.from === filters.from && dates.to === filters.to) return named;
  }
  return "pick";
}

/** "12 Sep to 20 Sep", or one day alone. What the Pick dates control reads. */
export function rangeLabel(filters: Filters): string | null {
  if (!filters.from && !filters.to) return null;
  const day = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Kolkata",
    })
      .formatToParts(new Date(`${iso}T12:00:00+05:30`))
      .map((p) => (p.type === "month" ? p.value.slice(0, 3) : p.value))
      .join("");
  if (filters.from && filters.to && filters.from !== filters.to) {
    return `${day(filters.from)} to ${day(filters.to)}`;
  }
  return day(filters.from || filters.to);
}

export interface Counts {
  requests: number;
  upcoming: number;
  past: number;
  cancelled: number;
}

export const NO_COUNTS: Counts = {
  requests: 0,
  upcoming: 0,
  past: 0,
  cancelled: 0,
};

/**
 * Which pill to open on when the URL names none.
 *
 * "Requests if `counts.requests > 0` in that response, otherwise Upcoming. Past
 * and Cancelled are never the default." A request has a clock on it and a
 * traveller behind it; nothing else on this screen expires.
 */
export function defaultView(counts: Counts): View {
  return counts.requests > 0 ? "requests" : "upcoming";
}

export const PILL_LABEL: Record<View, string> = {
  requests: "Requests",
  upcoming: "Upcoming",
  past: "Past",
  cancelled: "Cancelled",
};

export function countFor(counts: Counts, view: View): number {
  return counts[view];
}

/** "3 bookings · 7 guests". The totals count the rows loaded so far. */
export function dayTotals(bookings: readonly BookingLine[]): string {
  const guests = bookings.reduce((n, b) => n + b.guests, 0);
  const rows =
    bookings.length === 1 ? "1 booking" : `${bookings.length} bookings`;
  const people = guests === 1 ? "1 guest" : `${guests} guests`;
  return `${rows} · ${people}`;
}

/** What a row calls the person: their name, or the reference when it is empty. */
export function rowName(booking: BookingLine): string {
  const name = booking.name.trim();
  return name === "" ? booking.reference : name;
}

/** What an empty pill says, which depends on whether anything is narrowing it. */
export function emptyLine(view: View, filtered: boolean): string {
  if (filtered) {
    return view === "requests" ? "No requests match" : "No bookings match";
  }
  switch (view) {
    case "requests":
      return "No requests waiting";
    case "upcoming":
      return "No upcoming bookings";
    case "past":
      return "No past bookings";
    default:
      return "No cancelled bookings";
  }
}

export interface OpenRequestLike {
  contactName?: string;
  experienceId?: string;
  startsAt?: string;
  timezone?: string;
}

/**
 * Whether a request survives the filters — the ONE thing filtered in the portal.
 *
 * `GET /requests` takes no search, so this has to happen here, and it applies
 * exactly the three rules the API applies to `counts.requests`: name only, the
 * listing's id, and the trip's own market day. Anything else would make the
 * badge and the rows under it disagree, which is the one thing a count beside a
 * pill must never do.
 *
 * Matched on `experienceId` and never on the title: two listings may be called
 * the same thing, and a title is a label somebody can edit.
 */
export function matchesRequest(
  request: OpenRequestLike,
  filters: Filters,
): boolean {
  if (filters.q) {
    const name = (request.contactName ?? "").toLowerCase();
    if (!name.includes(filters.q.toLowerCase())) return false;
  }
  if (filters.experienceId && request.experienceId !== filters.experienceId) {
    return false;
  }
  if (filters.from || filters.to) {
    const day = marketDayOf(
      request.startsAt ?? "",
      request.timezone ?? "Asia/Kolkata",
    );
    if (day === null) return false;
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
  }
  return true;
}

/** The query string for a pill, keeping whatever is narrowing the list. */
export function pillHref(view: View, filters: Filters): string {
  const params = new URLSearchParams({ view });
  if (filters.q) params.set("q", filters.q);
  if (filters.experienceId) params.set("experienceId", filters.experienceId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  return `/bookings?${params.toString()}`;
}
