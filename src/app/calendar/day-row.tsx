import type { OperatorSlot } from "@/lib/day/types";
import {
  closureLine,
  closuresTouching,
  wholeDayClosures,
  type Closure,
} from "@/lib/day/closures";
import { soldOn, startTimeCount } from "@/lib/day/calendar";
import { lostSalesLabel, lostSalesOn, saleChip } from "@/lib/day/off-sale";
import { marketTime } from "@/lib/format/market-time";
import { cn } from "@/lib/cn";
import { Chip } from "@/components/ui/chip";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { DayPanel } from "./day-panel";
import { DepartureControls } from "./departure-controls";

/**
 * One of the fourteen days, as ONE row until it is opened
 * (yuvoy-operator#84 s7).
 *
 * Every departure used to be an open form, so a fortnight was a 26,000-pixel
 * page, about thirty phone screens, and the one thing this screen decides
 * (what can be sold) was buried in it. A day is now a single row: its date,
 * how many start times, how many seats sold, a mark when something on it is
 * not selling that should be, and Closed when the day is shut. Open the day to
 * see its departures; open a departure to change it.
 *
 * ## Native disclosure, and why
 *
 * `<details>` and `<summary>`, rendered on the server. They open on one bar of
 * signal before any JavaScript arrives, a screen reader announces them as
 * expanded or collapsed without a line of ARIA, and the keyboard works as it
 * does everywhere. React never sets `open`, so whatever the operator opened
 * stays open when a write re-reads the calendar underneath: the receipt of a
 * seat change, a counter sale or a closure is read inside the day it was made
 * in, which is the one rule every write on this screen depends on.
 *
 * ## A `section`, not a list item
 *
 * A departure's row stays the only `li` carrying its title, so everything that
 * finds a row by what it says (the tests, and a screen reader's list
 * navigation) still lands on one departure. The section is named by the day,
 * so it is also a landmark to jump between days by.
 */
export function DayRow({
  day,
  label,
  departures,
  guests,
  closures,
  canManage,
  canSellAtCounter,
}: {
  /** `YYYY-MM-DD`, the market's. */
  day: string;
  /** "Today", "Tomorrow", or the date written out. */
  label: string;
  departures: OperatorSlot[];
  /** Guests already confirmed on the day, or `null` when that is not known. */
  guests: number | null;
  /** Every closure the fortnight's read returned, reopened ones included. */
  closures: readonly Closure[];
  /** OWNER, ADMIN or MANAGER, on a business that is not suspended. */
  canManage: boolean;
  /** Anybody signed in, on a business that is not suspended. */
  canSellAtCounter: boolean;
}) {
  /*
    Closed is READ, not inferred (yuvoy-operator#45 item 1): a day with no
    departures can be closed, and a status carries no reason.
  */
  const wholeDay = wholeDayClosures(closures, day);
  const closed = wholeDay.length > 0;
  const touching = closuresTouching(
    closures,
    day,
    departures.map((s) => s.id),
  );
  const times = startTimeCount(departures);
  const lost = lostSalesOn(departures);
  const headingId = `day-${day}`;

  /*
    Two lines, so a long date keeps its width on a 360px phone: the day, then
    what is on it with any mark beside the numbers rather than squeezed in
    beside the date. The heading is a direct child of the row: a `<summary>`
    may hold a heading, and a `<span>` may not.
  */
  const summary = (
    <>
      <h3 id={headingId} className="col-start-1 text-base font-bold">
        {label}
      </h3>
      <span className="col-start-1 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="text-forest/70 text-sm">
          {departures.length === 0
            ? "No departures scheduled"
            : `${times} ${times === 1 ? "start time" : "start times"} · ${soldOn(departures)} sold`}
        </span>
        {/*
          Lost money, marked on the day rather than buried in a departure's
          card (#84 s7): seats nobody confirmed, a lapsed document, a business
          that is not selling. A departure the operator stopped, or one that
          is full, is not marked: see `lostSale`.
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
      </span>
    </>
  );

  /* The row's two columns: the words, and the chevron beside both lines. */
  const rowClass =
    "grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-3";

  /*
    A day with nothing to open (no departures, no closure to read, and nobody
    who may change it) is a plain row rather than a disclosure that opens onto
    nothing.
  */
  const hasContent = departures.length > 0 || wholeDay.length > 0 || canManage;

  return (
    <section aria-labelledby={headingId} className="border-paper-line border-t">
      {hasContent ? (
        <details className="group/day">
          <summary
            className={cn(
              rowClass,
              "cursor-pointer list-none [&::-webkit-details-marker]:hidden",
            )}
          >
            {summary}
            <ChevronRightIcon className="text-forest/75 ease-interaction col-start-2 row-span-2 row-start-1 size-5 shrink-0 transition-transform duration-200 group-open/day:rotate-90" />
          </summary>

          <div className="space-y-4 pb-6">
            {/*
              Why the day is closed, at the top of it. The badge on the row says
              that it is; this says why, and "back on the 14th" lives here.
            */}
            {wholeDay.map((closure) => (
              <p key={closure.id} className="text-forest/80 text-sm">
                {closureLine(closure)}
              </p>
            ))}

            {departures.length > 0 ? (
              <ul
                className={panelClass(
                  "raised",
                  "divide-paper-line divide-y p-0",
                )}
              >
                {departures.map((slot) => (
                  <DepartureRow
                    key={slot.id}
                    slot={slot}
                    canManage={canManage}
                    canSellAtCounter={canSellAtCounter}
                  />
                ))}
              </ul>
            ) : null}

            {/*
              On every day, a departure on it or not: closing next week before
              putting departures on it is ordinary, and a closed EMPTY day
              needs its way back too.
            */}
            {canManage ? (
              <DayPanel
                day={day}
                label={label}
                guests={guests}
                closed={closed}
                closures={touching}
              />
            ) : null}
          </div>
        </details>
      ) : (
        <div className={rowClass}>{summary}</div>
      )}
    </section>
  );
}

/**
 * One departure inside an opened day: its time, what it is, what is sold,
 * and a chip only when it is not simply selling. Open it to change it.
 */
function DepartureRow({
  slot,
  canManage,
  canSellAtCounter,
}: {
  slot: OperatorSlot;
  canManage: boolean;
  canSellAtCounter: boolean;
}) {
  const chip = saleChip(slot);

  return (
    <li>
      <details className="group/dep">
        <summary
          className={cn(
            "flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3",
            "[&::-webkit-details-marker]:hidden",
          )}
        >
          <span className="w-12 shrink-0 self-start pt-0.5 text-base font-bold tabular-nums">
            {marketTime(slot.startsAt, slot.timezone)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-sm font-bold">{slot.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-forest/70 text-xs tabular-nums">
                {slot.sold}/{slot.seats} sold
              </span>
              {chip ? (
                <Chip tone={chip.loud ? "accent" : "neutral"}>
                  {chip.label}
                </Chip>
              ) : null}
            </span>
          </span>
          <ChevronRightIcon className="text-forest/75 ease-interaction size-5 shrink-0 transition-transform duration-200 group-open/dep:rotate-90" />
        </summary>
        <div className="border-paper-line border-t px-4 pt-3 pb-5">
          <DepartureControls
            slot={slot}
            canManage={canManage}
            canSellAtCounter={canSellAtCounter}
          />
        </div>
      </details>
    </li>
  );
}
