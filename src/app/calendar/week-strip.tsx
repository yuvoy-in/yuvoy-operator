import { boardHref, type BoardRow } from "@/lib/day/board";
import { shortDate } from "@/lib/home/words";
import { DayStrip } from "./day-strip";

/**
 * The week on a phone: seven days in one row, the open one filled, today
 * named, and a mark under any day with something on it (operator
 * experiment B). The board's grid is for a desktop; on a phone the week is
 * this strip over the day it opens.
 *
 * Each day is a link, so the day is in the address and Back walks the days
 * looked at. It keeps the scroll where it was: the strip is above the fold,
 * and a jump to the top would only move it.
 *
 * Worked out here, on the server, and drawn by `DayStrip`, which answers the
 * press before the server does (O08 A).
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
    <DayStrip
      open={day}
      days={days.map((d) => {
        const count = rows.reduce(
          (n, row) =>
            n + (row.days.find((x) => x.day === d)?.departures.length ?? 0),
          0,
        );
        const [weekday, date] = shortDate(d).split(" ");
        return {
          day: d,
          href: boardHref({ week, day: d }, today),
          name: `${shortDate(d)}${d === today ? ", today" : ""}, ${
            count === 0
              ? "nothing on"
              : count === 1
                ? "1 departure"
                : `${count} departures`
          }`,
          weekday,
          date,
          today: d === today,
          on: count > 0,
        };
      })}
    />
  );
}
