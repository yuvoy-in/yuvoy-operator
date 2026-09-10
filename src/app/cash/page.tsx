import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { getCommissionOwed } from "@/lib/money/fetch";
import { linesReconcile } from "@/lib/money/commission";
import { formatPaise } from "@/lib/format/money";
import { marketDateLabel } from "@/lib/format/market-time";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Panel, panelClass } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Cash you've collected" };

/*
  Never prerendered, never cached. A balance is not a figure to serve from a
  cache that cannot move.
*/
export const dynamic = "force-dynamic";

const BACK = { href: "/account", label: "your business" };

/**
 * What the operator owes Yuvoy on cash we never handled — yuvoy-operator#40 §2.
 *
 * ## Why this screen exists at all
 *
 * For a card booking our commission comes out of the payout automatically and
 * the operator never thinks about it. For cash there is **no payout** — the
 * traveller paid them directly and we never touched the money — so our share
 * is a balance they owe us instead.
 *
 * "A bill that first appears as a demand gets argued about. One that has been
 * visible all along, with the trips behind it listed, gets paid." That is the
 * whole design intent, so this is not reducible to a single number: every line
 * carries reference, date, guests, fare and share, and every one is checkable.
 *
 * ## What it leads with, and why that order
 *
 * **What they collected**, not what they owe. The commission then reads as a
 * share of money already in their hand rather than a bill out of nowhere. The
 * wording follows: "cash taken" and "collected", never "paid" — they were
 * paid, we were not — and "Yuvoy's share", never "commission due" or
 * "outstanding".
 *
 * Nothing here may imply Yuvoy is holding the fare. We are not, and the ledger
 * says so: `capturedAmountPaise` is `0` on these bookings for their whole life.
 *
 * ## There is no "pay now" button, deliberately
 *
 * Settling a balance is money moving back to us, which is the same class of
 * act as money leaving, and the payout run spends two tables and three
 * signatures getting that right. Half of that machinery would be worse than a
 * number a person can read. The balance is visible; settlement happens between
 * people.
 *
 * ## Read-only, and OWNER/MANAGER
 *
 * Same gate as earnings, refused before the request rather than after it: "a
 * staff member who can see today's manifest does not need the margin on it."
 */
export default async function CashPage() {
  const { token, me } = await requireOperator();

  /*
    Refused before the request, like earnings. A staff login meeting a 403
    lands on the error boundary, which says "that did not load — try again":
    false, and unactionable, because nothing went wrong.
  */
  if (!me.canManage) {
    return (
      <Screen nav={{ back: BACK }} stageLabel="Cash">
        <p className="eyebrow text-terra-deep">The money</p>
        <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
          Cash you&rsquo;ve collected
        </h1>
        <p className="text-forest/80 mt-4 text-base">
          This one is for whoever handles the money. Ask an owner or a manager
          at your business — your sign-in works, it just does not open this.
        </p>
      </Screen>
    );
  }

  const commission = await getCommissionOwed(token);
  const addsUp = linesReconcile(commission);

  return (
    <Screen nav={{ back: BACK }} stageLabel="Cash">
      <p className="eyebrow text-terra-deep">{me.name || "Your account"}</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Cash you&rsquo;ve collected
      </h1>

      {commission.bookings === 0 ? (
        /*
          A real and common answer, not an error and not a spinner: every cash
          trip settled, or none taken yet. Said in words rather than shown as
          ₹0 across a table, which reads as a screen that failed to load.
        */
        <div className="mt-8">
          <Empty
            title="Nothing owed"
            body="Everything's settled. When a traveller books and pays you in cash on the day, the trip and Yuvoy's share of it appear here once the day is done."
          />
        </div>
      ) : (
        <>
          {/*
            COLLECTED FIRST, SHARE SECOND. The order is the argument: our cut
            reads as a share of something already in their hand rather than a
            demand.
          */}
          <Panel className="mt-8">
            <p className="text-4xl font-bold tabular-nums">
              {formatPaise(commission.farePaise)}
            </p>
            <p className="text-forest/80 mt-1 text-base">
              taken from travellers
            </p>

            <p className="mt-5 text-2xl font-bold tabular-nums">
              {formatPaise(commission.commissionPaise)}
            </p>
            <p className="text-forest/80 mt-1 text-base">Yuvoy&rsquo;s share</p>
          </Panel>

          <p className="text-forest/70 mt-4 text-sm">
            {/*
              Said plainly, because it is the question this screen answers and
              the one an operator asks first. Nothing anywhere implies we are
              holding the fare.
            */}
            You took this money directly, so there is no payout for us to take
            our share out of. It is a balance instead —{" "}
            {commission.bookings === 1
              ? "one completed trip"
              : `${commission.bookings} completed trips`}
            , listed below so every rupee is checkable.
          </p>

          {/*
            Every line is checkable is only TRUE if they add up. When they do
            not, say so rather than let an operator find it with a calculator
            and stop trusting the number.
          */}
          {!addsUp ? (
            <div className="mt-6">
              <Problem
                title="These lines do not add up to the total"
                body="The trips listed below do not account for the share shown above. Do not settle against this — send us the dates and we will find it."
              />
            </div>
          ) : null}

          <section className="mt-8" aria-labelledby="trips">
            <h2 id="trips" className="label text-forest/75">
              The trips behind it
            </h2>
            <ul className="mt-3 space-y-3">
              {commission.lines.map((line, i) => (
                <li
                  key={`${line.bookingReference}-${i}`}
                  className={panelClass()}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    {/*
                      The reference is what gets said out loud at a jetty and
                      quoted on the phone, so it is monospaced and selectable
                      rather than folded into a sentence.
                    */}
                    <p className="font-mono text-base font-bold">
                      {line.bookingReference || "—"}
                    </p>
                    <p className="text-forest/70 shrink-0 text-sm">
                      {line.tripDate ? marketDateLabel(line.tripDate) : null}
                    </p>
                  </div>
                  <p className="text-forest/70 mt-1 text-sm">
                    {line.guests === 1 ? "1 guest" : `${line.guests} guests`}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-bold tabular-nums">
                      {formatPaise(line.farePaise)}
                    </span>{" "}
                    taken ·{" "}
                    <span className="font-bold tabular-nums">
                      {formatPaise(line.commissionPaise)}
                    </span>{" "}
                    share
                  </p>
                  {/*
                    Only when it disagrees with the fare. A shortfall is a
                    thing the operator already knows about — they recorded it —
                    and repeating the fare on every ordinary row would bury the
                    one line that differs.

                    Our share is owed on the FARE, not on what they chose to
                    take: "a discount you gave is yours to have given." So this
                    explains the number rather than contradicting it.
                  */}
                  {line.collectedPaise !== undefined &&
                  line.collectedPaise !== line.farePaise ? (
                    <p className="text-forest/70 mt-1.5 text-sm">
                      You recorded taking {formatPaise(line.collectedPaise)}.
                      The share is worked out on the fare.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/*
        No "pay now", and this says why rather than leaving a silence somebody
        reads as an omission.
      */}
      <p className="border-cream-line text-forest/70 mt-10 border-t pt-6 text-sm">
        There is nothing to tap here. Settling up happens between us and a
        person, not through this screen — this is so the number is never a
        surprise when it does.
      </p>
    </Screen>
  );
}
