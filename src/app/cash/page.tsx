import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { getCommissionOwed } from "@/lib/money/fetch";
import {
  cashInHand,
  linesReconcile,
  type CommissionLine,
} from "@/lib/money/commission";
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

const BACK = { href: "/account/settings", label: "settings" };

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
          This one is for whoever handles the money. Ask an owner, an admin or a
          manager at your business. Your sign-in works, it just does not open
          this.
        </p>
      </Screen>
    );
  }

  const commission = await getCommissionOwed(token);
  const { held, unrecorded } = commission;
  const inHand = cashInHand(commission);
  const owedAddsUp = linesReconcile(commission);
  const heldAddsUp = held ? linesReconcile(held) : true;
  const nothingAtAll =
    commission.bookings === 0 &&
    (held?.bookings ?? 0) === 0 &&
    (unrecorded?.bookings ?? 0) === 0;

  return (
    <Screen nav={{ back: BACK }} stageLabel="Cash">
      {/*
        The money, not the person holding the phone. This printed the
        signed-in person's name above the business's cash, which on a shared
        phone reads as one staff member's takings (op#87 t3).
      */}
      <p className="eyebrow text-terra-deep">The money</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Cash you&rsquo;ve collected
      </h1>

      {nothingAtAll ? (
        /*
          A real and common answer, not an error and not a spinner: every cash
          trip settled, or none taken yet. Said in words rather than shown as
          ₹0 across a table, which reads as a screen that failed to load.
        */
        <div className="mt-8">
          <Empty
            title="Nothing owed"
            body="Everything's settled. When a traveller books and pays you in cash on the day, the trip and Yuvoy's share of it appear here."
          />
        </div>
      ) : (
        <>
          {/*
            COLLECTED FIRST, SHARE SECOND. The order is the argument: our cut
            reads as a share of something already in their hand rather than a
            demand.

            And ALL of what is in their hand (op#94 item 4). This showed only
            the trips already completed, so an operator holding ₹25,000 read
            ₹10,000: the cash taken for trips still to run was on no screen.
            When the API does not send the held figures (an older API), the
            screen is what it was, rather than a total missing a half.
          */}
          <Panel className="mt-8">
            <p className="text-4xl font-bold tabular-nums">
              {formatPaise(inHand ?? commission.farePaise)}
            </p>
            <p className="text-forest/80 mt-1 text-base">
              {inHand !== null
                ? "recorded as taken from travellers"
                : "taken from travellers"}
            </p>

            <dl className="border-paper-line mt-5 space-y-3 border-t pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm">Yuvoy&rsquo;s share, owed now</dt>
                <dd className="text-base font-bold tabular-nums">
                  {formatPaise(commission.commissionPaise)}
                </dd>
              </div>
              {held ? (
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="text-sm">
                    Yuvoy&rsquo;s share on trips still to run
                  </dt>
                  <dd className="text-forest/80 text-base tabular-nums">
                    {formatPaise(held.commissionPaise)}
                  </dd>
                </div>
              ) : null}
            </dl>
            {held ? (
              <p className="text-forest/70 mt-3 text-sm">
                The share on a trip still to run is owed once the trip is done.
              </p>
            ) : null}
          </Panel>

          {/*
            Trips that ran with no cash recorded (yuvoy-api#221). Nothing says
            whether the business was paid, so none of it is held or owed, and
            only the operator can close each one: record the cash, or mark the
            party a no-show. Above the lists, because it is the one thing on
            this screen that needs doing.
          */}
          {unrecorded && unrecorded.bookings > 0 ? (
            <section
              id="unrecorded"
              className="mt-8 scroll-mt-6"
              aria-labelledby="unrecorded-heading"
            >
              <h2 id="unrecorded-heading" className="label text-terra-deep">
                No cash recorded
              </h2>
              <div className="mt-3">
                <Problem
                  title={
                    unrecorded.bookings === 1
                      ? "1 past cash trip has no payment recorded"
                      : `${unrecorded.bookings} past cash trips have no payment recorded`
                  }
                  body="These trips have happened and nothing says whether you were paid. Record the cash if you took it, or mark the party a no-show if they did not come."
                />
              </div>
              <ul className="mt-3 space-y-3">
                {unrecorded.lines.map((line, i) => (
                  <li
                    key={`${line.bookingReference}-${i}`}
                    className={panelClass()}
                  >
                    <TripHead line={line} />
                    <p className="text-forest/70 mt-1 text-sm">
                      {guestsLabel(line.guests)} ·{" "}
                      <span className="tabular-nums">
                        {formatPaise(line.farePaise)}
                      </span>{" "}
                      fare
                    </p>
                    {line.bookingReference ? (
                      <Link
                        href={`/bookings?view=past&q=${encodeURIComponent(line.bookingReference)}`}
                        className="text-forest tap-target mt-1 inline-block text-sm underline underline-offset-2"
                      >
                        Open the booking
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* ------------------------------------------------ owed now -- */}
          <section className="mt-8" aria-labelledby="owed">
            <h2 id="owed" className="label text-forest/75">
              Owed now
            </h2>
            {commission.bookings === 0 ? (
              <p className="text-forest/70 mt-3 text-sm">
                Nothing yet. A trip&rsquo;s share is owed once it is done and
                its cash is recorded.
              </p>
            ) : (
              <>
                {/*
                  Said plainly, because it is the question this screen answers
                  and the one an operator asks first. Nothing anywhere implies
                  we are holding the fare.
                */}
                <p className="text-forest/70 mt-2 text-sm">
                  You took this money directly, so there is no payout for us to
                  take our share out of. It is a balance instead:{" "}
                  {commission.bookings === 1
                    ? "one completed trip"
                    : `${commission.bookings} completed trips`}
                  , listed so every rupee is checkable.
                </p>
                {/*
                  Every line is checkable is only TRUE if they add up. When they
                  do not, say so rather than let an operator find it with a
                  calculator and stop trusting the number.
                */}
                {!owedAddsUp ? (
                  <div className="mt-4">
                    <Problem
                      title="These lines do not add up to the total"
                      body="The trips listed below do not account for the share shown above. Do not settle against this. Send us the dates and we will find it."
                    />
                  </div>
                ) : null}
                <TripList lines={commission.lines} />
              </>
            )}
          </section>

          {/* -------------------------------------- held, still to run -- */}
          {held && held.bookings > 0 ? (
            <section className="mt-8" aria-labelledby="held">
              <h2 id="held" className="label text-forest/75">
                Held, trip still to run
              </h2>
              <p className="text-forest/70 mt-2 text-sm">
                Cash you have taken for trips that have not run yet. Trips
                finish on their own six hours after they end, and then this
                moves to owed.
              </p>
              {!heldAddsUp ? (
                <div className="mt-4">
                  <Problem
                    title="These lines do not add up to the total"
                    body="The trips listed below do not account for the share shown above. Send us the dates and we will find it."
                  />
                </div>
              ) : null}
              <TripList lines={held.lines} />
            </section>
          ) : null}
        </>
      )}

      {/*
        No "pay now", and this says why rather than leaving a silence somebody
        reads as an omission.
      */}
      <p className="border-paper-line text-forest/70 mt-10 border-t pt-6 text-sm">
        There is nothing to tap here. Settling up happens between us and a
        person, not through this screen. This is so the number is never a
        surprise when it does.
      </p>
    </Screen>
  );
}

function guestsLabel(guests: number): string {
  return guests === 1 ? "1 guest" : `${guests} guests`;
}

/**
 * The reference and the day, the two things an operator checks a line by.
 *
 * The reference is what gets said out loud at a jetty and quoted on the
 * phone, so it is monospaced and selectable rather than folded into a
 * sentence.
 */
function TripHead({ line }: { line: CommissionLine }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="font-mono text-base font-bold">
        {line.bookingReference || "-"}
      </p>
      <p className="text-forest/70 shrink-0 text-sm">
        {line.tripDate ? marketDateLabel(line.tripDate) : null}
      </p>
    </div>
  );
}

/** One list of cash trips: fare taken, and Yuvoy's share on the fare. */
function TripList({ lines }: { lines: CommissionLine[] }) {
  return (
    <ul className="mt-3 space-y-3">
      {lines.map((line, i) => (
        <li key={`${line.bookingReference}-${i}`} className={panelClass()}>
          <TripHead line={line} />
          <p className="text-forest/70 mt-1 text-sm">
            {guestsLabel(line.guests)}
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
            Only when it disagrees with the fare. A shortfall is a thing the
            operator already knows about (they recorded it), and repeating the
            fare on every ordinary row would bury the one line that differs.

            Our share is owed on the FARE, not on what they chose to take: "a
            discount you gave is yours to have given." So this explains the
            number rather than contradicting it.
          */}
          {line.collectedPaise !== undefined &&
          line.collectedPaise !== line.farePaise ? (
            <p className="text-forest/70 mt-1.5 text-sm">
              You recorded taking {formatPaise(line.collectedPaise)}. The share
              is worked out on the fare.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
