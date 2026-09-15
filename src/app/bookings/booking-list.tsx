"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { loadMoreBookings } from "./list-actions";
import {
  dayTotals,
  emptyLine,
  rowName,
  type Filters,
  type View,
} from "@/lib/bookings/list";
import { byMarketDay } from "@/lib/day/booking-days";
import { describeBookingState } from "@/lib/day/booking-state";
import type { BookingLine } from "@/lib/money/bookings";
import { dayCaption, marketTime } from "@/lib/format/market-time";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

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
      <p className="text-forest/70 mt-6 text-base">
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
    <div className="mt-6 space-y-6">
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
                    href={`/bookings/${booking.id}`}
                    className={panelClass(
                      "raised",
                      "ease-interaction hover:bg-cream flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-200",
                    )}
                  >
                    <span className="flex min-w-0 items-baseline gap-3">
                      <span className="shrink-0 font-mono text-sm tabular-nums">
                        {booking.startsAt
                          ? marketTime(booking.startsAt, booking.timezone)
                          : "--:--"}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-base font-bold">
                          {rowName(booking)}
                        </span>
                        <span className="text-forest/70 block truncate text-sm">
                          {booking.guests}
                          {" · "}
                          {booking.experience}
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {chip ? (
                        <Chip tone={chip.live ? "accent" : "neutral"}>
                          {chip.label}
                        </Chip>
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
          disabled={loading}
          onClick={more}
        >
          {loading ? "Loading…" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}
