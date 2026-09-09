import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listListings, listSlots } from "@/lib/day/manifest";
import { marketDays } from "@/lib/format/market-time";
import { Empty, Problem } from "@/components/ui/states";
import { SlotCapacity } from "./slot-capacity";
import { BlackoutForm } from "./blackout-form";
import { DepartureForm } from "./departure-form";
import { Screen } from "@/components/chrome/screen";

export const metadata: Metadata = { title: "Calendar" };

/*
  Never prerendered, never cached: every number on this page is a live seat
  count, and a stale one is what oversells a boat.
*/
export const dynamic = "force-dynamic";

/** How far ahead capacity is editable in one screen. */
const DAYS_AHEAD = 14;

/**
 * O9 — where the operator promises seats.
 *
 * One word per thing (D-031 C10, yuvoy-operator#36): a dated occurrence is
 * a DEPARTURE. "Slot" is our word — it is the database's and the API's —
 * and "trip" is the traveller's word for their own booking. Both appeared
 * on this screen, for the same object, within a scroll of each other.
 *
 * "The single most important number in the system." Two weeks ahead, because
 * that is what somebody with a few days on an island plans in, and because a
 * calendar of ninety days on a phone is a calendar nobody scrolls.
 */
export default async function CapacityPage() {
  const { token, me } = await requireOperator();
  const { today } = await marketDays();

  const end = new Date(`${today}T00:00:00+05:30`);
  end.setDate(end.getDate() + DAYS_AHEAD);
  /*
    Two calls, in parallel, answering two different questions.

    The fortnight is what this screen EDITS. The listings are every listing
    this operator has, from `GET /experiences` — the same source the Services
    tab reads, so a listing cannot exist on one tab and not the other
    (yuvoy-operator#32).

    They used to come off the departures, which made the picker a function of
    the departures a listing already had. A listing created an hour ago was
    absent from the one screen that could give it dates, and nothing on the
    page said why.
  */
  const [slots, listings] = await Promise.all([
    listSlots(token, today, end.toISOString().slice(0, 10)),
    listListings(token),
  ]);

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
        Capacity, blackouts and counter sales are all OWNER or MANAGER. A
        staff member can see the numbers and cannot change them, and being
        told that first beats typing one and reading a 403.
      */}
      {!me.canManage ? (
        <div className="mt-6">
          <Problem
            title="You can see these, but not change them"
            body="Seats, closed dates and counter sales need an owner or a manager."
          />
        </div>
      ) : null}

      {/*
        Adding comes before closing, and both before the list.

        The order is the order of the questions an operator arrives with: is
        there a departure for Saturday, is the week off, and what do the ones I
        have look like. Both forms are collapsed until pressed, so the list is
        still the first thing on the screen.
      */}
      {me.canManage ? (
        <div className="mt-8">
          <DepartureForm listings={listings} today={today} />
        </div>
      ) : null}

      <div className="mt-8">
        <BlackoutForm today={today} />
      </div>

      <div className="mt-8">
        {slots.length === 0 ? (
          <Empty
            title="Nothing scheduled"
            body="No departures in the next two weeks. A departure that is not here is one Yuvoy cannot sell."
          />
        ) : (
          <ul className="space-y-3">
            {slots.map((slot) => (
              <SlotCapacity key={slot.id} slot={slot} />
            ))}
          </ul>
        )}
      </div>
    </Screen>
  );
}
