import Link from "next/link";
import { boardHref, readWeek, weekStartOf } from "@/lib/day/board";
import { shiftDay } from "@/lib/day/calendar";
import { shortDate } from "@/lib/home/words";
import { buttonClass } from "@/components/ui/button";
import { ArrowLeftIcon, ArrowRightIcon } from "@/components/ui/icons";

/**
 * Which week the board shows, and the way to the ones either side.
 *
 * Any week, back as well as forward (audit 5.1): last week so yesterday's
 * departures can be closed out, next month so a departure three weeks away
 * can have its seats changed. "This week" is always one tap away from
 * anywhere else, the board's anchor.
 */
export function WeekNav({
  week,
  days,
  today,
  summary,
}: {
  /** The week's Monday. */
  week: string;
  days: readonly string[];
  today: string;
  /** "38 of 54 seats sold", or nothing to say. */
  summary: string | null;
}) {
  const thisWeek = weekStartOf(today);
  const previous = shiftDay(week, -7);
  const next = shiftDay(week, 7);
  // The pages stop a season either side: no link past the last one.
  const canPrevious = readWeek(previous, today) === previous;
  const canNext = readWeek(next, today) === next;
  const first = shortDate(days[0]);
  const last = shortDate(days[days.length - 1]);
  const link = buttonClass({
    variant: "secondary",
    size: "md",
    block: false,
    className: "gap-1.5",
  });

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h2
          id="board-week"
          className="font-display tracking-display leading-display text-2xl text-balance"
        >
          {week === thisWeek ? "This week" : `Week of ${first}`}
        </h2>
        <p className="text-forest/80 mt-1 text-sm tabular-nums">
          {first} to {last}
          {summary ? ` · ${summary}` : ""}
        </p>
      </div>
      <nav aria-label="Weeks" className="flex shrink-0 items-center gap-2">
        {canPrevious ? (
          <Link href={boardHref({ week: previous }, today)} className={link}>
            <ArrowLeftIcon className="size-4" />
            Earlier
          </Link>
        ) : null}
        {week !== thisWeek ? (
          <Link href="/calendar" className={link}>
            This week
          </Link>
        ) : null}
        {canNext ? (
          <Link href={boardHref({ week: next }, today)} className={link}>
            Later
            <ArrowRightIcon className="size-4" />
          </Link>
        ) : null}
      </nav>
    </div>
  );
}
