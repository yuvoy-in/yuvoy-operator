import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listClosures, listListings, listSlots } from "@/lib/day/manifest";
import {
  calendarDays,
  confirmedGuestsByDay,
  departuresOn,
} from "@/lib/day/calendar";
import { seatsUnconfirmed } from "@/lib/day/off-sale";
import { listBookings } from "@/lib/money/fetch";
import { dayCaption, marketDays } from "@/lib/format/market-time";
import { ConfirmSeats } from "@/components/listings/confirm-seats";
import { BlackoutForm } from "./blackout-form";
import { DayRow } from "./day-row";
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
 * ## Fourteen days, one row each (yuvoy-operator#84 s7)
 *
 * Today and the next thirteen, each ONE row until it is opened: the date, how
 * many start times, what is sold, and a mark when something on it is not
 * selling that should be. Every departure used to be an open form, which made
 * a fortnight about thirty phone screens long and buried the one decision
 * this screen exists for. See `DayRow`.
 *
 * A day with nothing on it still gets a row, because "nothing scheduled on
 * Thursday" is an answer and a gap in a list is not.
 *
 * **Calendar controls sellable capacity; Bookings owns customer obligation
 * resolution.** Closing here stops new sales and cancels nobody, and every
 * sentence on this screen about people already booked sends the operator to
 * Bookings rather than pretending to deal with them.
 *
 * One title and no paragraph explaining the screen (#80 t2, t4): what this
 * screen decides, what a counter sale is and what confirming seats means are
 * in help.
 */
export default async function CapacityPage() {
  const { token, me } = await requireOperator();
  const { today, tomorrow } = await marketDays();
  const days = calendarDays(today);
  const first = days[0];
  const last = days[days.length - 1];

  /*
    Four calls in parallel, answering four different questions.

    The fortnight's departures are what this screen EDITS. The listings are
    every listing this operator has, from `GET /experiences`, for the form that
    adds departures. The bookings are who is already confirmed on each day: the
    number in the one sentence a closure must say first. And the closures are
    what is already shut, which used to be guessed from each departure's status
    and therefore could not see a closed day with nothing on it, or say why.

    A failed bookings read costs that number and nothing else. A failed closures
    read costs the badge, so it degrades to none rather than taking a working
    seat-editing screen down; the day still reads and the departures still show
    their own status. `from` and `to` are market days on every one of these,
    asked for as they are (yuvoy-operator#45 item 6).
  */
  const [slots, listings, bookings, closures] = await Promise.all([
    listSlots(token, first, last),
    listListings(token),
    listBookings(token, first, last),
    listClosures(token, first, last).catch(() => []),
  ]);

  const guests = confirmedGuestsByDay(bookings, days);

  /*
    NOTHING that writes survives a suspension (yuvoy-operator#50): seats,
    closed dates, reopening and counter sales are none of them on the list a
    suspended business may still write, so the whole write surface goes rather
    than each control answering the suspension sentence one tap at a time. And
    a STAFF login is offered none of the rest: every other write here is
    OWNER, ADMIN or MANAGER, closing dates included, which used to be drawn for
    staff and refused after the tap.

    A counter sale is the exception, and staff DO get it. The API has never
    role-gated recording one or taking one back ("the person who mistypes the
    count is the person at the counter", yuvoy-api#226), and the owner
    confirmed on 23 Sep 2026 that everybody signed in may do both. A walk-up
    sale nobody may record is a seat we go on selling.
  */
  const canWrite = me.canManage && !me.suspension;
  const canSellAtCounter = !me.suspension;

  /*
    Departures in the fortnight off sale only because nobody confirmed their
    seats: the one lost sale a single tap puts right, for every listing at
    once. The receipt of that tap lives in the control, which stays mounted
    while the re-read takes the count to nothing.
  */
  const unconfirmed = slots.filter(seatsUnconfirmed).length;

  return (
    <Screen>
      {/* "Calendar", not "Capacity" — yuvoy-operator#32, #36. A calendar is
          what an operator thinks they are looking at; capacity is our word
          for the number inside it. D-031 C10. */}
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Calendar
      </h1>

      {/*
        One line for a staff login, saying who can change this, rather than a
        panel headed as though something had gone wrong (#45 item 7).
      */}
      {!me.canManage ? (
        <p className="text-forest/80 mt-3 text-base">
          Only owners, admins and managers can change seats or close dates.
        </p>
      ) : null}

      {canWrite ? (
        <div className="mt-6">
          <ConfirmSeats notOnSale={unconfirmed} goingOffSoon={0} />
        </div>
      ) : null}

      {/*
        Adding comes before closing, and both before the days: is there a
        departure for Saturday, is the week off, and what do the days I have
        look like. Both are collapsed until pressed, and closing is the quiet
        one, because it stops sales (#81).
      */}
      {canWrite ? (
        <div className="mt-6 space-y-3">
          <DepartureForm listings={listings} today={today} />
          <BlackoutForm today={today} />
        </div>
      ) : null}

      <section className="mt-10" aria-labelledby="fortnight">
        <h2 id="fortnight" className="label text-forest/75">
          The next fourteen days
        </h2>

        {/*
          The empty state goes when there is a CLOSURE to show, even with no
          departures at all. That is the case the inferred badge could never
          see: a shop that closed a fortnight in January had nothing scheduled
          and nothing on screen saying they had closed it, so the only way back
          was to remember the closure existed.
        */}
        {slots.length === 0 && closures.length === 0 ? (
          <p className="text-forest/70 mt-4 text-base">
            Nothing scheduled in the next two weeks
          </p>
        ) : (
          <div className="border-paper-line mt-3 border-b">
            {days.map((day) => (
              <DayRow
                key={day}
                day={day}
                label={dayCaption(day, today, tomorrow)}
                departures={departuresOn(slots, day)}
                guests={guests ? (guests.get(day) ?? 0) : null}
                closures={closures}
                canManage={canWrite}
                canSellAtCounter={canSellAtCounter}
              />
            ))}
          </div>
        )}
      </section>
    </Screen>
  );
}
