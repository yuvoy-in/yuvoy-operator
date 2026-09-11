import type { OperatorSlot } from "@/lib/day/types";
import { isClosedDay, soldOn, startTimeCount } from "@/lib/day/calendar";
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
  canManage,
}: {
  /** `YYYY-MM-DD`, the market's. */
  day: string;
  /** "Today", "Tomorrow", or the date written out. */
  label: string;
  departures: OperatorSlot[];
  /** Guests already confirmed on the day, or `null` when that is not known. */
  guests: number | null;
  canManage: boolean;
}) {
  const closed = isClosedDay(departures);
  const times = startTimeCount(departures);
  const running = departures.some((s) => s.status !== "cancelled");
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
      {canManage && running ? (
        <DayManage day={day} label={label} guests={guests} closed={closed} />
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
