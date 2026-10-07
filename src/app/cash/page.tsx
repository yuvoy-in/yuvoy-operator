import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getCommissionOwed, readCommissionStatements } from "@/lib/money/fetch";
import {
  cashInHand,
  linesReconcile,
  type CommissionLine,
} from "@/lib/money/commission";
import { totalOwed } from "@/lib/money/commission-statements";
import { formatPaise } from "@/lib/format/money";
import { marketDateLabel } from "@/lib/format/market-time";
import { helpHref } from "@/lib/help";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Panel, panelClass } from "@/components/ui/panel";
import { ChevronRightIcon } from "@/components/ui/icons";
import { SUPPORT_PHONE } from "@/lib/site/contact";
import { referenceHref } from "@/lib/bookings/list";

export const metadata: Metadata = { title: "Cash you've collected" };

/*
  Never prerendered, never cached. A balance is not a figure to serve from a
  cache that cannot move.
*/
export const dynamic = "force-dynamic";

/* Cash sits behind the Money tab now (yuvoy-operator#96). */
const BACK = { href: "/earnings", label: "Money" };

/**
 * The cash the operator took, and Yuvoy's share of it (yuvoy-operator#40 §2).
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
 * ## What is owed is on the statements, not here
 *
 * Since D-043 (yuvoy-operator#121) Yuvoy bills its share weekly, on a
 * commission statement paid by UPI from its own page. `GET /commission-owed`
 * still counts every completed cash trip, "billed or not, paid or not", so
 * this screen calls that figure Yuvoy's share on completed trips, never owed,
 * and what is still to pay comes from the statements, one tap away. There is
 * still no pay button here: a bill is paid against its reference, and only a
 * statement has one.
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
      <Screen nav={{ back: BACK }}>
        <h1 className="font-display tracking-display leading-display text-4xl text-balance">
          Cash you&rsquo;ve collected
        </h1>
        <p className="text-forest/80 leading-body mt-4 text-base text-pretty">
          This one is for whoever handles the money. Ask an owner, an admin or a
          manager at your business.
        </p>
      </Screen>
    );
  }

  /*
    The share is HARD: it is the screen. The statements are soft, and a
    failed read costs only the door that says what is owed.
  */
  const [commission, statements] = await Promise.all([
    getCommissionOwed(token),
    readCommissionStatements(token),
  ]);
  const { held, unrecorded } = commission;
  const inHand = cashInHand(commission);
  const completedAddsUp = linesReconcile(commission);
  const heldAddsUp = held ? linesReconcile(held) : true;
  const nothingAtAll =
    commission.bookings === 0 &&
    (held?.bookings ?? 0) === 0 &&
    (unrecorded?.bookings ?? 0) === 0;

  return (
    <Screen nav={{ back: BACK }}>
      {/*
        The heading and nothing above it. This printed the signed-in person's
        name above the business's cash, which on a shared phone reads as one
        staff member's takings (op#87 t3), and then an eyebrow that said "The
        money" over a heading that already did (op#80 t2).
      */}
      <h1 className="font-display tracking-display leading-display text-4xl text-balance">
        Cash you&rsquo;ve collected
      </h1>

      {nothingAtAll ? (
        /*
          A real and common answer, not an error and not a spinner: every cash
          trip settled, or none taken yet. Said in words rather than shown as
          ₹0 across a table, which reads as a screen that failed to load.
        */
        <>
          <div className="mt-8">
            <Empty
              title="No cash taken yet"
              body="Cash you record taking from travellers shows here, trip by trip."
            />
          </div>
          <StatementsDoor statements={statements} />
        </>
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
            {/* The figure on the board, as the Money tab draws it (v3.2). */}
            <p className="font-board text-4xl tabular-nums">
              {formatPaise(inHand ?? commission.farePaise)}
            </p>
            <p className="text-forest/80 mt-1 text-base">
              {inHand !== null
                ? "recorded as taken from travellers"
                : "taken from travellers"}
            </p>

            <dl className="border-paper-line mt-5 space-y-3 border-t pt-4">
              {/*
                Every completed trip, billed or not and paid or not: never
                "owed" (op#121). What is still to pay is the door below.
              */}
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-sm">
                  Yuvoy&rsquo;s share on completed trips
                </dt>
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
            {/*
              When a share becomes owed is the one idea here that is not
              obvious, and its explanation lives in Help (op#80 t4).
            */}
            <HelpLink id="cash-owed">When Yuvoy&rsquo;s share is owed</HelpLink>
          </Panel>

          <StatementsDoor statements={statements} />

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
                  body="Record the cash if you took it, or mark the party a no-show if they did not come."
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
                    {/*
                      By its reference under whichever pill holds it, never
                      Past alone: a trip from earlier today is still under
                      Upcoming until its day ends or its party is marked
                      (yuvoy-operator#158).
                    */}
                    {line.bookingReference ? (
                      <Link
                        href={referenceHref(line.bookingReference)}
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

          {/* ----------------------------------------- completed trips -- */}
          <section className="mt-8" aria-labelledby="completed">
            {/*
              "Completed trips", not "Owed now": the list is every completed
              cash trip, billed or not and paid or not (op#121), and what is
              still to pay is on the statements.
            */}
            <h2 id="completed" className="label text-forest/75">
              Completed trips
            </h2>
            {commission.bookings === 0 ? (
              <p className="text-forest/70 leading-body mt-3 text-sm text-pretty">
                No completed cash trips yet.
              </p>
            ) : (
              <>
                {/*
                  Every line is checkable is only TRUE if they add up. When they
                  do not, say so rather than let an operator find it with a
                  calculator and stop trusting the number.
                */}
                {!completedAddsUp ? (
                  <div className="mt-4">
                    <Problem
                      title="These lines do not add up to the total"
                      body={`The trips listed below do not account for the share shown above. Call us on ${SUPPORT_PHONE} with the dates and we will find it.`}
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
              {!heldAddsUp ? (
                <div className="mt-4">
                  <Problem
                    title="These lines do not add up to the total"
                    body={`The trips listed below do not account for the share shown above. Call us on ${SUPPORT_PHONE} with the dates and we will find it.`}
                  />
                </div>
              ) : null}
              <TripList lines={held.lines} />
            </section>
          ) : null}
        </>
      )}

      {/*
        How paying works is one tap away rather than a paragraph at the foot
        of every visit: "An operator reads none of it after the first week"
        (op#80 t4).
      */}
      <div className="border-paper-line mt-10 border-t pt-4">
        <HelpLink id="settling-cash">How to pay Yuvoy&rsquo;s share</HelpLink>
      </div>
    </Screen>
  );
}

/**
 * The way to the commission statements, saying what is owed on them
 * (op#121): the one "owed" this screen may say, because `/commission-owed`
 * counts paid trips too.
 *
 * A failed read is said on the door rather than drawn as nothing owed, and
 * the list behind it reads again when opened.
 */
function StatementsDoor({
  statements,
}: {
  statements: Awaited<ReturnType<typeof readCommissionStatements>>;
}) {
  const owed = statements
    ? totalOwed(statements.items, statements.complete)
    : null;
  const detail =
    statements === null
      ? "Did not load. Open them to try again."
      : statements.items.length === 0
        ? "None yet. Yuvoy bills its share weekly."
        : owed === null
          ? "Each says what is left to pay on it."
          : owed > 0
            ? `${formatPaise(owed)} owed`
            : "Nothing owed";
  return (
    <Link
      href="/earnings/commission"
      className={panelClass(
        statements !== null && (owed ?? 0) > 0 ? "alert" : "raised",
        "ease-interaction hover:bg-paper mt-3 flex min-h-14 items-center justify-between gap-4 p-4 transition-colors duration-200",
      )}
    >
      <span className="min-w-0">
        <span className="block text-base font-bold text-balance">
          Commission statements
        </span>
        <span className="text-forest/80 mt-0.5 block text-sm tabular-nums">
          {detail}
        </span>
      </span>
      <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
    </Link>
  );
}

/** A small way to the answer, for an idea on this screen that is not obvious. */
function HelpLink({ id, children }: { id: string; children: ReactNode }) {
  return (
    <Link
      href={helpHref(id, "/cash")}
      className="text-forest/80 hover:text-forest mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
    >
      {children}
    </Link>
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
      <p className="tracking-ref text-base font-bold slashed-zero tabular-nums">
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
            <p className="text-forest/70 leading-body mt-1.5 text-sm text-pretty">
              You recorded taking {formatPaise(line.collectedPaise)}. The share
              is worked out on the fare.
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
