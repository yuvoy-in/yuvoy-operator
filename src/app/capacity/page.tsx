import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { listSlots } from "@/lib/day/manifest";
import { marketDays } from "@/lib/format/market-time";
import { Empty, Problem } from "@/components/ui/states";
import { SlotCapacity } from "./slot-capacity";
import { BlackoutForm } from "./blackout-form";

export const metadata: Metadata = { title: "Capacity" };

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
 * "The single most important number in the system." Two weeks ahead, because
 * that is what somebody with a few days on an island plans in, and because a
 * calendar of ninety days on a phone is a calendar nobody scrolls.
 */
export default async function CapacityPage() {
  const { token, me } = await requireOperator();
  const { today } = await marketDays();

  const end = new Date(`${today}T00:00:00+05:30`);
  end.setDate(end.getDate() + DAYS_AHEAD);
  const slots = await listSlots(token, today, end.toISOString().slice(0, 10));

  return (
    <main className="bg-cream text-forest min-h-dvh">
      <div className="container-page max-w-2xl py-8">
        <Link
          href="/today"
          className="label text-forest/70 hover:text-forest tap-target underline underline-offset-4"
        >
          ← The day
        </Link>

        <p className="eyebrow text-terra-deep mt-6">Next two weeks</p>
        <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
          Capacity
        </h1>
        <p className="text-forest/70 mt-3 text-base">
          What each departure offers, and what you have sold at your own
          counter.
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
      </div>
    </main>
  );
}
