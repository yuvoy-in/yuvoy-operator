import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listClosures, listListings, listSlots } from "@/lib/day/manifest";
import {
  calendarDays,
  confirmedGuestsByDay,
  departuresOn,
} from "@/lib/day/calendar";
import { listBookings } from "@/lib/money/fetch";
import { dayCaption, marketDays } from "@/lib/format/market-time";
import { Empty, Problem } from "@/components/ui/states";
import { BlackoutForm } from "./blackout-form";
import { DayGroup } from "./day-group";
import { DepartureForm } from "./departure-form";
import { Screen } from "@/components/chrome/screen";

export const metadata: Metadata = { title: "Calendar" };

/*
  Never prerendered, never cached: every number on this page is a live seat
  count, and a stale one is what oversells a boat.
*/
export const dynamic = "force-dynamic";

/**
 * O9 — where the operator promises seats.
 *
 * One word per thing (D-031 C10, yuvoy-operator#36): a dated occurrence is
 * a DEPARTURE. "Slot" is our word — it is the database's and the API's —
 * and "trip" is the traveller's word for their own booking. Both appeared
 * on this screen, for the same object, within a scroll of each other.
 *
 * "The single most important number in the system."
 *
 * ## Fourteen days, one at a time — yuvoy-operator#45
 *
 * Today and the next thirteen, each with its name, how many times boats leave,
 * what is sold, and a Manage that closes the day in place. A day with nothing
 * on it still gets a line, because "nothing scheduled on Thursday" is an
 * answer and a gap in a list is not.
 *
 * **Calendar controls sellable capacity; Bookings owns customer obligation
 * resolution.** Closing here stops new sales and cancels nobody, and every
 * sentence on this screen about people already booked sends the operator to
 * Bookings rather than pretending to deal with them.
 */
export default async function CapacityPage() {
  const { token, me } = await requireOperator();
  const { today, tomorrow } = await marketDays();
  const days = calendarDays(today);
  const first = days[0];
  const last = days[days.length - 1];
  /*
    Asked for exactly the fortnight. `from` and `to` are market days on both
    `GET /slots` and `GET /bookings`, inclusive — this used to widen by a day
    either side because the API read them as UTC days, which asked for two days
    nobody wanted and then threw them away (yuvoy-operator#45 item 6).
  */

  /*
    Three calls, in parallel, answering three different questions.

    The fortnight's departures are what this screen EDITS. The listings are
    every listing this operator has, from `GET /experiences` — the same source
    the Listings tab reads, so a listing cannot exist on one tab and not the
    other (yuvoy-operator#32). And the bookings are who is already confirmed
    on each day: the number in the one sentence a closure must say first.

    A failed bookings read costs that number and nothing else — the sentence
    is still said, without a count — so it degrades to `null` rather than
    taking a working seat-editing screen down.
  */
  /*
    Four calls in parallel, answering four different questions.

    The fortnight's departures are what this screen EDITS. The listings are
    every listing this operator has, from `GET /experiences`. The bookings are
    who is already confirmed on each day: the number in the one sentence a
    closure must say first. And the closures are what is already shut, which
    used to be guessed from each departure's status and therefore could not see
    a closed day with nothing on it, or say why any day was closed.

    A failed bookings read costs that number and nothing else. A failed closures
    read costs the badge, so it degrades to none rather than taking a working
    seat-editing screen down; the day still reads and the departures still show
    their own status.
  */
  const [slots, listings, bookings, closures] = await Promise.all([
    listSlots(token, first, last),
    listListings(token),
    listBookings(token, first, last),
    listClosures(token, first, last).catch(() => []),
  ]);

  const guests = confirmedGuestsByDay(bookings, days);

  return (
    <Screen>
      <p className="eyebrow text-terra-deep">Next two weeks</p>
      {/* "Calendar", not "Capacity" — yuvoy-operator#32, #36. A calendar is
          what an operator thinks they are looking at; capacity is our word
          for the number inside it. D-031 C10. */}
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Calendar
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        What each departure offers, and what you have sold at your own counter.
      </p>

      {/*
        Capacity, blackouts and counter sales are all OWNER, ADMIN or MANAGER. A
        staff member can see the numbers and cannot change them, and being
        told that first beats typing one and reading a 403.
      */}
      {!me.canManage ? (
        <div className="mt-6">
          <Problem
            title="You can see these, but not change them"
            body="Only owners, admins and managers can change seats, close dates or record counter sales."
          />
        </div>
      ) : null}

      {/*
        Adding comes before closing, and both before the days.

        The order is the order of the questions an operator arrives with: is
        there a departure for Saturday, is the week off, and what do the days I
        have look like. Both forms are collapsed until pressed, so the days are
        still the first thing on the screen.
      */}
      {/*
        NOTHING on this screen survives a suspension - yuvoy-operator#50.
        Seats, closed dates, reopening, moving a departure and counter sales
        are none of them on the list a suspended business may still write, so
        the whole write surface goes rather than each control answering the
        suspension sentence one tap at a time. The banner above already says
        why, and the days themselves still read.
      */}
      {me.canManage && !me.suspension ? (
        <div className="mt-8">
          <DepartureForm listings={listings} today={today} />
        </div>
      ) : null}

      {/*
        Closing dates is `POST /blackouts`, which is not on the list a
        suspended business may still write (yuvoy-operator#50).

        Worth noting for #45, which reworks this screen: this form is drawn for
        every role, including STAFF, who the API refuses. That gap predates
        this change and is left alone here rather than fixed in passing.
      */}
      {me.suspension ? null : (
        <div className="mt-8">
          <BlackoutForm today={today} />
        </div>
      )}

      <section className="mt-12" aria-labelledby="fortnight">
        <h2 id="fortnight" className="font-display text-3xl">
          The next fourteen days
        </h2>
        <p className="text-forest/70 mt-2 text-sm">
          This screen decides what can still be sold. The people already booked
          are looked after in Bookings.
        </p>

        {/*
          The empty state goes when there is a CLOSURE to show, even with no
          departures at all. That is the case the inferred badge could never
          see: a shop that closed a fortnight in January had nothing scheduled
          and nothing on screen saying they had closed it, so the only way back
          was to remember the closure existed.
        */}
        {slots.length === 0 && closures.length === 0 ? (
          <div className="mt-6">
            <Empty
              title="Nothing scheduled"
              body="No departures in the next two weeks. A departure that is not here is one Yuvoy cannot sell."
            />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {days.map((day) => (
              <DayGroup
                key={day}
                day={day}
                label={dayCaption(day, today, tomorrow)}
                departures={departuresOn(slots, day)}
                guests={guests ? (guests.get(day) ?? 0) : null}
                closures={closures}
                canManage={me.canManage && !me.suspension}
              />
            ))}
          </div>
        )}
      </section>
    </Screen>
  );
}
