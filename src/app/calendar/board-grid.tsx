import Link from "next/link";
import { boardHref, type BoardRow } from "@/lib/day/board";
import { shortDate } from "@/lib/home/words";
import { withFrom } from "@/lib/site/back-to";
import { cn } from "@/lib/cn";
import { BoardKeys } from "./board-keys";
import { FillBar } from "./fill-bar";
import { departureName, requestsWord } from "./day-section";

/**
 * The board on a desktop: listings down the side, the week's days across,
 * every departure in its cell (operator experiment B, approved as the
 * Calendar).
 *
 * A real table, so a screen reader can walk it by row and column and hear
 * each header. Each departure is a link that opens the inspector beside the
 * board, its time and its seats written out and a fill under them (which
 * grows when the operator sets the seats, `FillBar`), and its state as the
 * calendar's word. The listing's name opens its hub, where its
 * weekly schedule and Pause are. A day's header opens that day below, with
 * the day's own actions.
 *
 * Arrow keys move between departures (`BoardKeys`); Tab and Enter work
 * without them.
 */
export function BoardGrid({
  week,
  days,
  day,
  today,
  rows,
  closedDays,
}: {
  week: string;
  days: readonly string[];
  /** The day open below the board. */
  day: string;
  today: string;
  rows: readonly BoardRow[];
  /** Days a whole-day closure shuts. */
  closedDays: ReadonlySet<string>;
}) {
  const here = boardHref({ week, day }, today);
  return (
    <div className="mt-5 hidden lg:block">
      <BoardKeys>
        <div className="border-paper-line rounded-card overflow-x-auto border">
          <table className="w-full min-w-[50rem] border-separate border-spacing-0 text-left">
            <caption className="sr-only">
              Departures by listing, {shortDate(days[0])} to{" "}
              {shortDate(days[days.length - 1])}
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="bg-paper-deep border-paper-line sticky left-0 z-10 w-44 border-b px-4 py-3"
                >
                  <span className="label text-forest/75">Listing</span>
                </th>
                {days.map((d) => {
                  const [weekday, date] = shortDate(d).split(" ");
                  const open = d === day;
                  return (
                    <th
                      key={d}
                      scope="col"
                      className={cn(
                        "border-paper-line border-b border-l px-2 py-2 align-top",
                        open ? "bg-forest/5" : "bg-paper-deep",
                      )}
                    >
                      <Link
                        href={boardHref({ week, day: d }, today)}
                        scroll={false}
                        aria-current={open ? "page" : undefined}
                        className={cn(
                          "rounded-control flex min-h-11 flex-col justify-center px-2",
                          open && "ring-forest ring-1",
                        )}
                      >
                        <span className="text-forest/80 text-xs">
                          {weekday}
                          {d === today ? " · Today" : ""}
                        </span>
                        <span className="text-base font-bold tabular-nums">
                          {date}
                        </span>
                      </Link>
                      {closedDays.has(d) ? (
                        <span className="text-forest/80 mt-1 block px-2 text-xs font-bold">
                          Closed
                        </span>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={row.listingId}>
                  <th
                    scope="row"
                    className="bg-paper border-paper-line sticky left-0 z-10 border-b px-4 py-3 align-top"
                  >
                    {row.listingId.startsWith("untitled:") ? (
                      <span className="text-sm font-bold">{row.title}</span>
                    ) : (
                      <Link
                        href={withFrom(`/today/listing/${row.listingId}`, here)}
                        className="decoration-forest/40 hover:decoration-forest text-sm font-bold underline underline-offset-4"
                      >
                        {row.title}
                      </Link>
                    )}
                    {row.occupancy ? (
                      <span className="text-forest/70 mt-1 block text-xs">
                        {row.occupancy}
                      </span>
                    ) : null}
                  </th>
                  {row.days.map((cell, c) => (
                    <td
                      key={cell.day}
                      className={cn(
                        "border-paper-line border-b border-l p-1.5 align-top",
                        cell.closed && "bg-paper-line/40",
                        cell.day === day && "bg-forest/5",
                      )}
                    >
                      <ul className="space-y-1">
                        {cell.departures.map((dep) => {
                          return (
                            <li key={dep.id}>
                              <Link
                                href={boardHref(
                                  { week, day: cell.day, dep: dep.id },
                                  today,
                                )}
                                scroll={false}
                                data-row={r}
                                data-col={c}
                                data-departure={dep.id}
                                aria-label={departureName(
                                  dep,
                                  shortDate(cell.day),
                                )}
                                className={cn(
                                  "rounded-control block border px-2 py-1.5",
                                  "ease-interaction transition-colors duration-200",
                                  dep.calledOff || dep.departed
                                    ? "border-paper-line bg-paper text-forest/70"
                                    : "border-paper-line bg-paper-deep hover:border-forest/40",
                                  dep.chip?.loud && "border-terra-deep",
                                )}
                              >
                                <span className="flex items-baseline justify-between gap-1">
                                  <span
                                    className={cn(
                                      "text-sm font-bold tabular-nums",
                                      dep.calledOff && "line-through",
                                    )}
                                  >
                                    {dep.time}
                                  </span>
                                  <span className="text-xs tabular-nums">
                                    {dep.people}/{dep.seats}
                                  </span>
                                </span>
                                <FillBar
                                  departure={dep.id}
                                  people={dep.people}
                                  seats={dep.seats}
                                />
                                {dep.chip ? (
                                  <span
                                    className={cn(
                                      "mt-1 block text-[11px] leading-tight",
                                      dep.chip.loud
                                        ? "text-terra-deep font-bold"
                                        : "text-forest/80",
                                    )}
                                  >
                                    {dep.chip.label}
                                  </span>
                                ) : null}
                                {dep.waiting > 0 ? (
                                  <span className="text-terra-deep mt-0.5 block text-[11px] leading-tight font-bold">
                                    {requestsWord(dep.waiting)}
                                  </span>
                                ) : null}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BoardKeys>
    </div>
  );
}
