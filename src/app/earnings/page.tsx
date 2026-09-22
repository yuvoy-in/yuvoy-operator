import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import {
  getChangeRequests,
  getSettlementOverview,
  listSettlements,
} from "@/lib/money/fetch";
import { payoutHold } from "@/lib/money/earnings";
import {
  SETTLEMENT_STATE_LABEL,
  isOwedBack,
  showsAdjustments,
  weekLabel,
  seasonStartLabel,
  nextSettlementNote,
  type Settlement,
} from "@/lib/money/settlements";
import { formatPaise } from "@/lib/format/money";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Earnings" };

/*
  Never prerendered, never cached. A figure that can still move must not be
  served from a cache that cannot.
*/
export const dynamic = "force-dynamic";

const BACK = { href: "/account/settings", label: "settings" };

/**
 * What the business is paid — yuvoy-operator#47.
 *
 * ## What this replaces
 *
 * A month picker over `GET /earnings`, showing gross minus commission minus
 * refunds for "this month" or "last month". The owner removed it on 14 Sep,
 * and the reason is that a calendar month was never the unit money moves in: a
 * payout is a Monday-to-Sunday week, and a booking belongs to the week its
 * TRIP happened in, not the month it was paid for. So the old screen's total
 * was a number no transfer ever matched.
 *
 * ## The one rule this screen exists to hold
 *
 * **The pipeline is never earned.** `pipeline.netPaise` is card bookings still
 * to run, and the contract says it "is **never** part of anything earned".
 * It has its own block, visually separate, with its own sentence, and no total
 * anywhere on this screen includes it. An operator who reads a pipeline figure
 * inside a total believes we owe them money for trips that have not happened.
 *
 * Cash is the same shape and for a different reason: the traveller pays the
 * operator directly, so it "never passes through a settlement" at all. What
 * they owe US on it is `/cash`, which this links to rather than restates.
 *
 * ## Read-only
 *
 * There is no action here except downloading a statement of a payout that has
 * already been sent. Nothing on this screen can change what anybody is paid.
 */
export default async function EarningsPage() {
  const { token, me } = await requireOperator();

  /*
    Refused before the request, not after it.

    Every settlement endpoint "Requires OWNER, ADMIN or MANAGER" and answers
    403 to a staff login. Making the call anyway put the throw on the error
    boundary, which says "That did not load, try again": false, and
    unactionable, because nothing went wrong.

    An ADMIN can do everything a MANAGER can, so the sentence names all three
    (op#48 item 3).
  */
  if (!me.canManage) {
    return (
      <Screen nav={{ back: BACK }} stageLabel="Earnings">
        <p className="eyebrow text-terra-deep">The money</p>
        <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
          Earnings
        </h1>
        <div className="mt-6">
          <Problem
            title="Only owners, admins and managers can see what the business is paid"
            body="A staff login runs the day: today's manifest, who has arrived. It does not carry what the business is owed. Ask an owner, an admin or a manager if you need the figure."
          />
        </div>
      </Screen>
    );
  }

  const [overview, changes, past] = await Promise.all([
    getSettlementOverview(token),
    getChangeRequests(token),
    listSettlements(token),
  ]);

  const hold = payoutHold(changes);
  const { nextSettlement, pipeline, paidAtCounter, seasonToDate } = overview;
  /*
    Cash taken for trips still to run, and trips that ran with no cash
    recorded (yuvoy-api#211, #221; op#94). Required in the contract since
    22 Sep and read as optional all the same: an older API sends neither, and
    "₹0 taken" or "0 unrecorded" drawn from silence would be a claim.
  */
  const heldKnown =
    Number.isInteger(paidAtCounter.heldBookings) &&
    Number.isInteger(paidAtCounter.heldCollectedPaise);
  const unrecordedBookings = Number.isInteger(paidAtCounter.unrecordedBookings)
    ? paidAtCounter.unrecordedBookings
    : 0;

  return (
    <Screen nav={{ back: BACK }} stageLabel="Earnings">
      {/*
        The money, not the person holding the phone: this printed the signed-in
        person's name above the business's earnings (op#87 t3).
      */}
      <p className="eyebrow text-terra-deep">The money</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Earnings
      </h1>

      {/*
        A payout held by a bank change in flight. Above the number, because it
        changes what the number means: it is owed, and it is not moving.
      */}
      {hold ? (
        <div className="mt-6">
          {/*
            The original body, restored rather than rewritten.

            My first pass replaced it with a general sentence and dropped two
            things an operator can ACT on: which stage the change is at, and
            that they can stop it if they did not request it. An e2e caught it,
            which is the right outcome and the reason those sentences were
            asserted in the first place.
          */}
          <Problem
            title="Payouts are on hold while your bank change is reviewed"
            body={`${hold.summary ?? "A bank change"} is ${
              hold.state === "cooling"
                ? "approved and waiting out its cooling period"
                : hold.state === "objection_window"
                  ? "in its objection window: you can still stop it"
                  : "awaiting review"
            }. Nothing is paid out until it settles. If you did not request this, stop it now from Payout details.`}
          />
        </div>
      ) : null}

      {/* ------------------------------------------- 1. next settlement -- */}

      <Panel className="mt-6" role="region" aria-labelledby="next-settlement">
        <h2 id="next-settlement" className="label text-forest/75">
          Next settlement
        </h2>
        <p className="text-forest/70 mt-1 text-sm">
          {weekLabel(nextSettlement.periodStart, nextSettlement.periodEnd)}
        </p>

        {/*
          The net can be BELOW ZERO, and the minus sign is the whole message: a
          correction larger than the week pays means the week is not paid at all
          until somebody at Yuvoy decides how to recover it. Nothing clamps it.
        */}
        <p
          className={cn(
            "font-display tracking-display mt-4 text-4xl leading-none",
            isOwedBack(nextSettlement.netPaise) && "text-terra-deep",
          )}
        >
          {formatPaise(nextSettlement.netPaise)}
        </p>
        {isOwedBack(nextSettlement.netPaise) ? (
          <p className="text-terra-deep mt-2 text-sm">
            A correction is larger than this week pays. Nothing is sent until we
            have agreed with you how to settle it.
          </p>
        ) : null}

        <dl className="mt-5 space-y-2 text-sm">
          <Row label="Fares" value={formatPaise(nextSettlement.grossPaise)} />
          <Row
            label="Our commission"
            value={formatPaise(nextSettlement.commissionPaise)}
          />
          <Row
            label="Refunded"
            value={formatPaise(nextSettlement.refundsPaise)}
          />
          {/*
            Only when there is one. A row reading "Corrections ₹0" on every
            payout trains somebody to stop reading the block that occasionally
            says something important.
          */}
          {showsAdjustments(nextSettlement.adjustmentsPaise) ? (
            <Row
              label="Corrections"
              value={formatPaise(nextSettlement.adjustmentsPaise)}
            />
          ) : null}
          <Row label="Bookings" value={String(nextSettlement.bookings)} plain />
        </dl>

        <p className="text-forest/70 mt-5 text-sm">
          {nextSettlementNote(nextSettlement.settlesFrom)}
        </p>
      </Panel>

      {/* ------------------------------------- 2. booked, not run yet ---- */}

      {/*
        Its own panel, deliberately apart from the one above. This figure is
        NEVER added to anything earned: the trips have not happened, so the
        money is not owed. `settlements.test.ts` has no function that sums the
        two, and there is none to write.
      */}
      <Panel
        tone="outline"
        className="mt-4"
        role="region"
        aria-labelledby="booked-not-run"
      >
        <h2 id="booked-not-run" className="label text-forest/75">
          Booked, not run yet
        </h2>
        <p className="font-display tracking-display mt-3 text-2xl leading-none">
          {formatPaise(pipeline.netPaise)}
        </p>
        <p className="text-forest/70 mt-2 text-sm">
          Not earned until the trip is marked.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Bookings" value={String(pipeline.bookings)} plain />
        </dl>
      </Panel>

      {/* ----------------------------- 3. cash bookings still to run ----- */}

      <Panel
        tone="outline"
        className="mt-4"
        role="region"
        aria-labelledby="cash-to-run"
      >
        <h2 id="cash-to-run" className="label text-forest/75">
          Cash bookings still to run
        </h2>
        <p className="font-display tracking-display mt-3 text-2xl leading-none">
          {formatPaise(paidAtCounter.netPaise)}
        </p>
        <p className="text-forest/70 mt-2 text-sm">
          The traveller pays you on the day, so none of this passes through a
          settlement.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <Row label="Fares" value={formatPaise(paidAtCounter.farePaise)} />
          <Row
            label="Our commission"
            value={formatPaise(paidAtCounter.commissionPaise)}
          />
          <Row label="Bookings" value={String(paidAtCounter.bookings)} plain />
          {/*
            Of those, the cash already in hand: "the same figure
            `GET /commission-owed` shows as `heldCollectedPaise`", so this panel
            and the Cash screen agree (op#94 item 4).
          */}
          {heldKnown ? (
            <>
              <Row
                label="Cash already taken"
                value={formatPaise(paidAtCounter.heldCollectedPaise)}
              />
              <Row
                label="Bookings paid already"
                value={String(paidAtCounter.heldBookings)}
                plain
              />
            </>
          ) : null}
        </dl>
        <Link
          href="/cash"
          className="text-terra-deep tap-target mt-4 inline-block text-sm underline underline-offset-4"
        >
          What you owe us on cash already taken
        </Link>
      </Panel>

      {/*
        Trips that ran with no cash recorded, apart from "still to run" and in
        none of its figures: "these trips have happened, and nothing here says
        whether you were paid". They used to be counted as still to run, which
        is how 7 past trips read as ₹60,000 of bookings to come (op#96).
      */}
      {unrecordedBookings > 0 ? (
        <Panel
          tone="alert"
          className="mt-4"
          role="region"
          aria-labelledby="cash-unrecorded"
        >
          <h2 id="cash-unrecorded" className="label text-terra-deep">
            Past cash trips with no payment recorded
          </h2>
          <p className="font-display tracking-display mt-3 text-2xl leading-none">
            {unrecordedBookings}
          </p>
          <p className="text-forest/80 mt-2 text-sm">
            These trips have happened and nothing says whether you were paid, so
            they are in none of the figures above. Record the cash if you took
            it, or mark the party a no-show.
          </p>
          {Number.isInteger(paidAtCounter.unrecordedFarePaise) ? (
            <dl className="mt-4 space-y-2 text-sm">
              <Row
                label="Fares agreed"
                value={formatPaise(paidAtCounter.unrecordedFarePaise)}
              />
            </dl>
          ) : null}
          <Link
            href="/cash#unrecorded"
            className="text-terra-deep tap-target mt-4 inline-block text-sm underline underline-offset-4"
          >
            See the trips
          </Link>
        </Panel>
      ) : null}

      {/* ------------------------------------------- 4. season so far ---- */}

      <Panel className="mt-4" role="region" aria-labelledby="season">
        <h2 id="season" className="label text-forest/75">
          Season so far
        </h2>
        <p className="text-forest/70 mt-1 text-sm">
          Since {seasonStartLabel(seasonToDate.from)}
        </p>
        <p className="font-display tracking-display mt-4 text-3xl leading-none">
          {formatPaise(seasonToDate.netPaise)}
        </p>
        <dl className="mt-5 space-y-2 text-sm">
          <Row label="Fares" value={formatPaise(seasonToDate.grossPaise)} />
          <Row
            label="Our commission"
            value={formatPaise(seasonToDate.commissionPaise)}
          />
          <Row
            label="Refunded"
            value={formatPaise(seasonToDate.refundsPaise)}
          />
          {showsAdjustments(seasonToDate.adjustmentsPaise) ? (
            <Row
              label="Corrections"
              value={formatPaise(seasonToDate.adjustmentsPaise)}
            />
          ) : null}
          <Row
            label="Payouts sent"
            value={String(seasonToDate.settlements)}
            plain
          />
          <Row label="Bookings" value={String(seasonToDate.bookings)} plain />
        </dl>
      </Panel>

      {/* -------------------------------------- 5. past settlements ------ */}

      <section className="mt-10">
        <h2 className="font-display tracking-display text-2xl leading-tight">
          Past settlements
        </h2>

        {/*
          `null` is "we could not load it" and `[]` is "there are none": two
          different sentences, and a list that could not load must not take the
          figures above it down with it.
        */}
        {past === null ? (
          <div className="mt-4">
            <Problem
              title="We could not load your past settlements"
              body="The figures above are still correct. Try again in a moment."
            />
          </div>
        ) : past.items.length === 0 ? (
          <div className="mt-4">
            <Empty
              title="No payouts yet"
              body="A week appears here once it has been locked for payment."
            />
          </div>
        ) : (
          <>
            <ul className="mt-4 space-y-3">
              {past.items.map((settlement) => (
                <li key={settlement.id}>
                  <SettlementRow settlement={settlement} />
                </li>
              ))}
            </ul>

            {/*
              "Show more" while there is more, and `complete` is what says so.
              The contract is explicit: "Told rather than inferred. Do not infer
              the end from a short page." A link rather than a button, because
              this page is server-rendered and paging is a navigation.
            */}
            {!past.complete && past.nextCursor ? (
              <Link
                href={`/earnings?cursor=${encodeURIComponent(past.nextCursor)}`}
                className="text-terra-deep tap-target mt-5 inline-block text-sm underline underline-offset-4"
              >
                Show more
              </Link>
            ) : null}
          </>
        )}
      </section>
    </Screen>
  );
}

/** One line of the arithmetic. `plain` is a count rather than an amount. */
function Row({
  label,
  value,
  plain,
}: {
  label: string;
  value: string;
  plain?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-forest/75">{label}</dt>
      <dd className={cn("tabular-nums", !plain && "font-bold")}>{value}</dd>
    </div>
  );
}

function SettlementRow({ settlement }: { settlement: Settlement }) {
  return (
    <Link
      href={`/earnings/${settlement.id}`}
      className="rounded-card border-paper-line bg-paper-deep hover:border-forest/40 ease-interaction flex items-center justify-between gap-4 border p-4 transition-colors duration-200"
    >
      <div className="min-w-0">
        <p className="font-bold">
          {weekLabel(settlement.periodStart, settlement.periodEnd)}
        </p>
        <p className="text-forest/70 mt-1 text-sm">
          {SETTLEMENT_STATE_LABEL[settlement.state]} ·{" "}
          {settlement.bookings === 1
            ? "1 booking"
            : `${settlement.bookings} bookings`}
        </p>
      </div>
      <p
        className={cn(
          "shrink-0 font-bold tabular-nums",
          isOwedBack(settlement.netPaise) && "text-terra-deep",
        )}
      >
        {formatPaise(settlement.netPaise)}
      </p>
    </Link>
  );
}
