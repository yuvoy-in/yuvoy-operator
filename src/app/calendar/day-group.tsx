import type { OperatorSlot } from "@/lib/day/types";
import {
  closureLine,
  closuresTouching,
  wholeDayClosures,
  type Closure,
} from "@/lib/day/closures";
import { soldOn, startTimeCount } from "@/lib/day/calendar";
import { Chip } from "@/components/ui/chip";
import { DayManage } from "./day-manage";
import { SlotCapacity } from "./slot-capacity";

/**
 * One of the fourteen days — yuvoy-operator#45.
 *
 * Its name, a Closed badge when every departure still running is closed, how
 * many different times boats leave, and what is sold; then Manage, then the
 * departures themselves.
 *
 * A `section`, not a list item. A departure's row stays the only `li` carrying
 * its title, so everything that finds a row by what it says — the tests, and a
 * screen reader's list navigation — still lands on one departure.
 *
 * "No departures scheduled" rather than the demo's "No slots scheduled": a
 * dated occurrence is a DEPARTURE on every operator screen (D-031 C10), and
 * "slot" is the database's word.
 */
export function DayGroup({
  day,
  label,
  departures,
  guests,
  closures,
  canManage,
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
  canManage: boolean;
}) {
  /*
    Closed is READ, not inferred (yuvoy-operator#45 item 1).

    It used to be "every departure still running is closed", which cannot see a
    day with no departures on it: a shop that closed a fortnight in January got
    fourteen ordinary empty days and no sign that anything had been done. And a
    status carries no reason, so the badge could never say why.
  */
  const wholeDay = wholeDayClosures(closures, day);
  const closed = wholeDay.length > 0;
  const touching = closuresTouching(
    closures,
    day,
    departures.map((s) => s.id),
  );
  const times = startTimeCount(departures);
  const headingId = `day-${day}`;

  return (
    <section
      aria-labelledby={headingId}
      className="border-cream-line border-t pt-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="font-display text-2xl">
          {label}
        </h3>
        {closed ? <Chip>Closed</Chip> : null}
      </div>
      <p className="text-forest/70 mt-1 text-sm">
        {departures.length === 0
          ? "No departures scheduled"
          : `${times} ${times === 1 ? "start time" : "start times"} · ${soldOn(departures)} sold`}
      </p>

      {/*
        Manage only where there is something to close. Kept on a day that is
        already closed, rather than removed with the form: the receipt a close
        produces lives inside it, and the revalidate that turns the day Closed
        would otherwise take away "You still owe 3 bookings" the instant it
        appeared.
      */}
      {/*
        Why the day is closed, on the day row and not only inside Manage. A
        badge with no reason beside it is the thing an operator opens Manage to
        find out, and the note is where "back on the 14th" lives.
      */}
      {wholeDay.map((closure) => (
        <p key={closure.id} className="text-forest/80 mt-1 text-sm">
          {closureLine(closure)}
        </p>
      ))}

      {/*
        Manage on EVERY day, not only one with a departure still running.

        It used to need one, and that left two holes. A day with nothing
        scheduled could not be closed from its own row, though closing next week
        before putting departures on it is an ordinary thing to do and the form
        at the top of the screen would take it. And a closed EMPTY day had no way
        back at all: the badge said Closed and nothing beside it could undo
        it. There is always something to do here, so it is always offered.
      */}
      {canManage ? (
        <DayManage
          day={day}
          label={label}
          guests={guests}
          closed={closed}
          closures={touching}
          departures={departures}
        />
      ) : null}

      {departures.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {departures.map((slot) => (
            <SlotCapacity key={slot.id} slot={slot} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
