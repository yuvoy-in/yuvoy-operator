"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { loadMoreBookings } from "./list-actions";
import {
  dayTotals,
  emptyLine,
  pillHref,
  rowName,
  type Filters,
  type View,
} from "@/lib/bookings/list";
import { byMarketDay } from "@/lib/day/booking-days";
import { describeBookingState } from "@/lib/day/booking-state";
import type { BookingLine } from "@/lib/money/bookings";
import { dayCaption, marketTime } from "@/lib/format/market-time";
import { markChange } from "@/lib/motion/mark";
import { Announcer } from "@/components/ui/announcer";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { StatusChip } from "@/components/ui/status-chip";
import { withFrom } from "@/lib/site/back-to";

/**
 * The chip each booking was last drawn with, by booking, for as long as the
 * portal is open (O03 A, approved 4 Oct 2026; the named integration change
 * "the list remembers the chips it last drew"). A module's memory outlives
 * a client navigation, so coming back from a booking finds the row whose
 * state changed while the operator was on it (the cash just taken there,
 * a party checked in on another phone) and marks it.
 */
const drawnChips = new Map<string, string>();

/** What a row's chip says, or nothing. */
function chipOf(booking: BookingLine): string {
  return describeBookingState(booking.state, booking.cash)?.label ?? "";
}

/**
 * The rows under Upcoming, Past and Cancelled — yuvoy-operator#57 item 8.
 *
 * ## Grouped by the MARKET day, and ordered by the pill
 *
 * Upcoming reads soonest first, because it is a plan. Past and Cancelled read
 * most recent first, because they are a record and the thing somebody is
 * looking for is usually the last one. The API sends the rows in that order
 * already; the grouping only has to keep it.
 *
 * ## The header counts what is LOADED, and that is deliberate
 *
 * "The totals count the rows loaded so far." A day header claiming seven guests
 * above four rows would be a screen arguing with itself. The pill's badge is
 * the total, and that one comes from the server.
 *
 * ## No reference on a row
 *
 * "It stays on `/bookings/{id}`." A row is scanned at a jetty for a name and a
 * time; the reference is what somebody reads out once they have found them.
 *
 * ## A state that changes is seen to change (O03 A, approved 4 Oct 2026)
 *
 * A re-read (focus, every minute) brings the server's latest state for the
 * rows already drawn, and they take it in place: the chip's words
 * cross-fade (`StatusChip`), the row carries the forest mark that fades
 * over 1.2s, and the change is said once ("Daniel Okafor: Checked in.").
 * Only the state and its cash are taken: which rows, how many and in what
 * order still change only when the list is drawn afresh, because rows that
 * come and go under a thumb are what this screen must not do. Drawn afresh
 * (back from a booking), a row whose chip is not the one this list last
 * drew is marked, and not said: it is usually the operator's own change.
 */
export function BookingList({
  view,
  filters,
  initial,
  today,
  tomorrow,
}: {
  view: Exclude<View, "requests">;
  filters: Filters;
  initial: { items: BookingLine[]; complete: boolean; nextCursor?: string };
  today: string;
  tomorrow: string;
}) {
  const [page, setPage] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, start] = useTransition();

  /*
    The server's latest answer for the rows drawn, taken in place (see
    above). Worked out while rendering, React's "storing information from
    previous renders"; the marks are drawn after the commit.
  */
  const [read, setRead] = useState(initial);
  const [said, setSaid] = useState({ text: "", n: 0 });
  const [changed, setChanged] = useState<{ ids: string[]; n: number }>({
    ids: [],
    n: 0,
  });
  if (initial !== read) {
    setRead(initial);
    const latest = new Map(initial.items.map((b) => [b.id, b]));
    const items = page.items.map((booking) => {
      const now = latest.get(booking.id);
      if (!now) return booking;
      const sameCash =
        JSON.stringify(now.cash) === JSON.stringify(booking.cash);
      return now.state === booking.state && sameCash
        ? booking
        : { ...booking, state: now.state, cash: now.cash };
    });
    const ids: string[] = [];
    const lines: string[] = [];
    items.forEach((next, i) => {
      const label = chipOf(next);
      if (next === page.items[i] || !label) return;
      if (label === chipOf(page.items[i])) return;
      ids.push(next.id);
      lines.push(`${rowName(next)}: ${label}.`);
    });
    if (items.some((next, i) => next !== page.items[i])) {
      setPage({ ...page, items });
    }
    if (ids.length > 0) {
      setChanged((was) => ({ ids, n: was.n + 1 }));
      setSaid((was) => ({ text: lines.join(" "), n: was.n + 1 }));
    }
  }

  const rows = useRef<HTMLDivElement>(null);
  const rowOf = useCallback(
    (id: string) =>
      Array.from(
        rows.current?.querySelectorAll<HTMLElement>("[data-booking]") ?? [],
      ).find((el) => el.dataset.booking === id) ?? null,
    [],
  );

  /*
    Drawn afresh: mark what is not as this list last drew it. Once, as the
    list is drawn; a re-read is marked as it lands, below.
  */
  const compared = useRef(false);
  useLayoutEffect(() => {
    if (compared.current) return;
    compared.current = true;
    for (const booking of page.items) {
      const before = drawnChips.get(booking.id);
      if (before !== undefined && before !== chipOf(booking)) {
        markChange(rowOf(booking.id));
      }
    }
  }, [page.items, rowOf]);

  // Changed under the operator's eyes: marked as it lands.
  useLayoutEffect(() => {
    for (const id of changed.ids) markChange(rowOf(id));
  }, [changed, rowOf]);

  // And remembered, every time, for the next time this list is drawn.
  useLayoutEffect(() => {
    for (const booking of page.items) {
      drawnChips.set(booking.id, chipOf(booking));
    }
  }, [page]);

  function more() {
    const cursor = page.nextCursor;
    if (!cursor) return;
    setFailure(null);
    start(async () => {
      const next = await loadMoreBookings({ view, ...filters, cursor });
      if (!next.ok) {
        setFailure(next.message);
        return;
      }
      setPage((was) => ({
        items: [...was.items, ...next.items],
        complete: next.complete,
        nextCursor: next.nextCursor,
      }));
    });
  }

  if (page.items.length === 0) {
    return (
      <p className="text-forest/70 leading-body mt-6 text-base text-pretty">
        {emptyLine(
          view,
          Boolean(
            filters.q || filters.experienceId || filters.from || filters.to,
          ),
        )}
      </p>
    );
  }

  const days = byMarketDay(page.items);
  /*
    Most recent first on the two backward-looking pills. `byMarketDay` sorts
    earliest first, which is right for a plan and exactly wrong for a record:
    somebody opening Past is looking for the last thing that happened.
  */
  const ordered = view === "upcoming" ? days : [...days].reverse();

  return (
    <div ref={rows} className="mt-6 space-y-6">
      <Announcer said={said} />
      {ordered.map((day) => (
        <section key={day.day || "undated"}>
          <h2 className="label text-forest/75">
            {day.day ? dayCaption(day.day, today, tomorrow) : "No date on file"}
            {" · "}
            {dayTotals(day.bookings)}
          </h2>
          <ul className="mt-2 space-y-2">
            {day.bookings.map((booking) => {
              const chip = describeBookingState(booking.state, booking.cash);
              return (
                <li key={booking.id || booking.reference}>
                  <Link
                    data-booking={booking.id}
                    href={withFrom(
                      `/bookings/${booking.id}`,
                      pillHref(view, filters),
                    )}
                    className={panelClass(
                      "raised",
                      "ease-interaction hover:bg-paper flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-200",
                    )}
                  >
                    <span className="flex min-w-0 items-baseline gap-3">
                      <span className="shrink-0 text-sm tabular-nums">
                        {booking.startsAt
                          ? marketTime(booking.startsAt, booking.timezone)
                          : "--:--"}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-base font-bold">
                          {rowName(booking)}
                        </span>
                        {/* The experience in its host's words (v3.2). */}
                        <span className="text-forest/70 block truncate text-sm">
                          {booking.guests}
                          {" · "}
                          <span className="voice-host">
                            {booking.experience}
                          </span>
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {chip ? (
                        <StatusChip
                          label={chip.label}
                          tone={chip.live ? "accent" : "neutral"}
                        />
                      ) : null}
                      <ChevronRightIcon className="text-terra-deep size-5" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {failure ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {failure}
        </p>
      ) : null}

      {/*
        `complete` is told by the API rather than inferred from a short page, so
        a full last page does not leave a button that loads nothing.
      */}
      {!page.complete && page.nextCursor ? (
        <Button
          variant="secondary"
          block={false}
          pending={loading}
          pendingLabel="Loading"
          onClick={more}
        >
          Show more
        </Button>
      ) : null}
    </div>
  );
}
