import Link from "next/link";
import { boardHref, type BoardRow } from "@/lib/day/board";
import { shortDate } from "@/lib/home/words";
import { cn } from "@/lib/cn";

/**
 * The week on a phone: seven days in one row, the open one filled, today
 * named, and a mark under any day with something on it (operator
 * experiment B). The board's grid is for a desktop; on a phone the week is
 * this strip over the day it opens.
 *
 * Each day is a link, so the day is in the address and Back walks the days
 * looked at. It keeps the scroll where it was: the strip is above the fold,
 * and a jump to the top would only move it.
 */
export function WeekStrip({
  week,
  days,
  day,
  today,
  rows,
}: {
  week: string;
  days: readonly string[];
  /** The day open under the strip. */
  day: string;
  today: string;
  rows: readonly BoardRow[];
}) {
  return (
    <nav aria-label="Days" className="mt-5 grid grid-cols-7 gap-1 lg:hidden">
      {days.map((d) => {
        const count = rows.reduce(
          (n, row) =>
            n + (row.days.find((x) => x.day === d)?.departures.length ?? 0),
          0,
        );
        const [weekday, date] = shortDate(d).split(" ");
        const open = d === day;
        const name = `${shortDate(d)}${d === today ? ", today" : ""}, ${
          count === 0
            ? "nothing on"
            : count === 1
              ? "1 departure"
              : `${count} departures`
        }`;
        return (
          <Link
            key={d}
            href={boardHref({ week, day: d }, today)}
            scroll={false}
            aria-label={name}
            aria-current={open ? "page" : undefined}
            className={cn(
              "rounded-control flex min-h-14 flex-col items-center justify-center border text-center",
              "ease-interaction transition-colors duration-200",
              open
                ? "border-forest bg-forest text-paper"
                : "border-paper-line bg-paper-deep text-forest hover:border-forest/40",
              // Today is ringed, so the dot below only ever means "something on".
              d === today && !open && "border-terra-deep border-2",
            )}
          >
            <span className="text-[11px] leading-none">{weekday}</span>
            <span className="mt-1 text-lg leading-none font-bold tabular-nums">
              {date}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "mt-1 size-1.5 rounded-full",
                count === 0
                  ? "bg-transparent"
                  : open
                    ? "bg-paper"
                    : "bg-forest",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
