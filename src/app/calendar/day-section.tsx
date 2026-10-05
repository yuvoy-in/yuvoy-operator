import Link from "next/link";
import { boardHref, type BoardDeparture } from "@/lib/day/board";
import { daySummary } from "@/lib/day/calendar";
import {
  closureLine,
  closuresTouching,
  wholeDayClosures,
  type Closure,
} from "@/lib/day/closures";
import { lostSalesLabel, lostSalesOn } from "@/lib/day/off-sale";
import type { OperatorSlot } from "@/lib/day/types";
import { Chip } from "@/components/ui/chip";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { DayPanel } from "./day-panel";

/**
 * The day open on the board: what is on it, whether it is closed and why,
 * and the day's own actions, closing it and reopening what is closed.
 *
 * On a phone it also lists the day's departures, each opening the inspector;
 * on a desktop the grid above already shows them, so the list is not drawn
 * twice. A region named by the day, as the fortnight's rows were, so the day
 * is findable by its name.
 */
export function DaySection({
  week,
  day,
  today,
  label,
  departures,
  cells,
  guests,
  closures,
  canManage,
}: {
  week: string;
  day: string;
  today: string;
  /** "Today", "Tomorrow", or the date written out. */
  label: string;
  /** The day's departures, first off first. */
  departures: readonly OperatorSlot[];
  /** The same departures as the board says them. */
  cells: readonly BoardDeparture[];
  /** Guests already confirmed on the day, or `null` when that is not known. */
  guests: number | null;
  /** Every closure the week's read returned, reopened ones included. */
  closures: readonly Closure[];
  /** OWNER, ADMIN or MANAGER, on a business that is not suspended. */
  canManage: boolean;
}) {
  // Closed is READ, not inferred (yuvoy-operator#45 item 1).
  const wholeDay = wholeDayClosures(closures, day);
  const closed = wholeDay.length > 0;
  const touching = closuresTouching(
    closures,
    day,
    departures.map((s) => s.id),
  );
  const lost = lostSalesOn(departures);
  const headingId = `day-${day}`;

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h3 id={headingId} className="text-lg font-bold">
        {label}
      </h3>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-forest/80 text-sm">{daySummary(departures)}</span>
        {/*
          Lost money, marked on the day (#84 s7): seats nobody confirmed, a
          lapsed document, a business that is not selling. A departure the
          operator stopped, or one that is full, is not marked: see `lostSale`.
        */}
        {lost > 0 ? (
          <Chip tone="accent">
            <span
              aria-hidden="true"
              className="bg-terra-deep size-2 rounded-full"
            />
            {lostSalesLabel(lost)}
          </Chip>
        ) : null}
        {closed ? <Chip>Closed</Chip> : null}
      </p>

      {/* Why the day is closed, at the top of it, with when it opens again. */}
      {wholeDay.map((closure) => (
        <p key={closure.id} className="text-forest/80 mt-2 text-sm">
          {closureLine(closure)}
        </p>
      ))}

      {cells.length > 0 ? (
        <ul
          className={panelClass(
            "raised",
            // Clipped, so a row's mark keeps the panel's rounded corners.
            "divide-paper-line mt-3 divide-y overflow-hidden p-0 lg:hidden",
          )}
        >
          {cells.map((cell) => (
            // `data-departure`: the inspector marks a row whose seats it saved.
            <li key={cell.id} data-departure={cell.id}>
              <Link
                href={boardHref({ week, day, dep: cell.id }, today)}
                scroll={false}
                aria-label={departureName(cell)}
                className="flex min-h-14 items-center gap-3 px-4 py-3"
              >
                <span className="w-12 shrink-0 self-start pt-0.5 text-base font-bold tabular-nums">
                  {cell.time}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-sm font-bold">
                    {cell.title}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-forest/70 text-xs tabular-nums">
                      {cell.people}/{cell.seats} sold
                    </span>
                    {cell.chip ? (
                      <Chip tone={cell.chip.loud ? "accent" : "neutral"}>
                        {cell.chip.label}
                      </Chip>
                    ) : null}
                    {cell.waiting > 0 ? (
                      <Chip tone="accent">{requestsWord(cell.waiting)}</Chip>
                    ) : null}
                  </span>
                </span>
                <ChevronRightIcon className="text-forest/75 size-5 shrink-0" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        On every day, a departure on it or not: closing next week before
        putting departures on it is ordinary, and a closed EMPTY day needs its
        way back too.
      */}
      {canManage ? (
        <div className="mt-4">
          <DayPanel
            day={day}
            label={label}
            guests={guests}
            closed={closed}
            closures={touching}
          />
        </div>
      ) : null}
    </section>
  );
}

/**
 * A departure as one name, so a screen reader hears "09:00 Try-dive, 5 of 8
 * sold, Not on sale" and not the run of its spans ("09:00Try-dive5/8").
 */
export function departureName(cell: BoardDeparture, day?: string): string {
  const parts = [
    ...(day ? [day] : []),
    `${cell.time} ${cell.title}`,
    `${cell.people} of ${cell.seats} sold`,
  ];
  if (cell.chip) parts.push(cell.chip.label);
  if (cell.closed && cell.chip?.label !== "Closed") parts.push("Closed");
  if (cell.waiting > 0) {
    parts.push(
      cell.waiting === 1
        ? "1 request waiting"
        : `${cell.waiting} requests waiting`,
    );
  }
  return parts.join(", ");
}

/** "1 request", "2 requests": the chip on a departure people are asking for. */
export function requestsWord(n: number): string {
  return n === 1 ? "1 request" : `${n} requests`;
}
