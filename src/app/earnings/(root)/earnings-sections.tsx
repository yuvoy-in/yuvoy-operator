/**
 * The money page's sections: the hold warning, the next payout, booked
 * but not yet run, and cash. Moved out of page.tsx (yuvoy-operator#178).
 */
import Link from "next/link";
import { payoutDestination, type ChangeRequest } from "@/lib/money/earnings";
import type { OnFile } from "@/lib/account/bank";
import {
  isOwedBack,
  nextSettlementNote,
  showsAdjustments,
  weekLabel,
  type SettlementPipeline,
  type SettlementWeek,
} from "@/lib/money/settlements";
import { cashLead, type CashOnTheTab } from "@/lib/money/overview";
import { formatPaise } from "@/lib/format/money";
import { AccountLine } from "@/components/account/account-line";
import { Panel, panelClass } from "@/components/ui/panel";
import { BanknoteIcon, ChevronRightIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { Row, Door, HelpLink } from "./earnings-parts";

/**
 * The bank change holding the payout. The original sentences, which say the
 * two things an operator can act on: which stage the change is at, and that
 * they can stop it if they did not ask for it.
 */
export function HoldWarning({
  hold,
  canStop,
}: {
  hold: ChangeRequest;
  /**
   * OWNER or ADMIN. A manager reads this screen too, and was told to "stop it
   * now" on a Payout details that then refused them.
   */
  canStop: boolean;
}) {
  const stage =
    hold.state === "cooling"
      ? "approved and waiting out its cooling period"
      : hold.state === "objection_window"
        ? canStop
          ? "in its objection window: you can still stop it"
          : "in its objection window"
        : "awaiting review";
  return (
    <Panel tone="alert" className="mt-6 p-6">
      <p className="text-terra-deep text-base font-bold text-balance">
        Payouts are on hold while your bank change is reviewed
      </p>
      <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
        {hold.summary ?? "A bank change"} is {stage}. Nothing is paid out until
        it settles.{" "}
        {canStop
          ? "If you did not request this, stop it now from "
          : "If nobody at your business asked for it, an owner or an admin can stop it from "}
        <Link
          href="/payouts"
          className="text-terra-deep font-bold underline underline-offset-4"
        >
          Payout details
        </Link>
        .
      </p>
    </Panel>
  );
}

/**
 * What Yuvoy will pay for the week, with the arithmetic behind it, and where
 * it goes: the bank inside the payout (operator A, approved 3 Oct 2026).
 */
export function NextPayout({
  week,
  to,
  heldLine,
}: {
  week: SettlementWeek;
  /** The account on file, as Payout details says it. `null`: none on file. */
  to: OnFile | null;
  /**
   * Why nothing is paid out yet, said in place of the account, or `null`
   * when nothing holds the payout. See `heldDestinationLine`.
   */
  heldLine: string | null;
}) {
  const owedBack = isOwedBack(week.netPaise);
  const destination = payoutDestination(
    week.netPaise,
    to?.line ?? null,
    heldLine !== null,
  );
  return (
    <Panel className="mt-6" role="region" aria-labelledby="next-payout">
      <h2 id="next-payout" className="label text-forest/75">
        Next payout
      </h2>
      <p className="text-forest/70 mt-1 text-sm">
        {weekLabel(week.periodStart, week.periodEnd)}
      </p>

      {/*
        The net can be BELOW ZERO, and the minus sign is the whole message: a
        correction larger than the week pays means the week is not paid at all
        until somebody at Yuvoy decides how to recover it. Nothing clamps it.
      */}
      <p
        className={cn(
          // A figure on the board, untracked as every board figure is (v3.2).
          "font-board mt-4 text-4xl leading-none tabular-nums",
          owedBack && "text-terra-deep",
        )}
      >
        {formatPaise(week.netPaise)}
      </p>
      {owedBack ? (
        <p className="text-terra-deep leading-body mt-2 text-sm text-pretty">
          A correction is larger than this week pays. Nothing is sent until we
          have agreed with you how to settle it.
        </p>
      ) : null}

      <dl className="mt-5 space-y-2 text-sm">
        <Row label="Fares" value={formatPaise(week.grossPaise)} />
        {/* "Yuvoy's share", the words Cash already uses (op#87 s15). */}
        <Row label="Yuvoy's share" value={formatPaise(week.commissionPaise)} />
        <Row label="Refunded" value={formatPaise(week.refundsPaise)} />
        {/*
          Only when there is one. A row reading "Corrections ₹0" on every
          payout trains somebody to stop reading the block that occasionally
          says something important.
        */}
        {showsAdjustments(week.adjustmentsPaise) ? (
          <Row label="Corrections" value={formatPaise(week.adjustmentsPaise)} />
        ) : null}
        <Row label="Bookings" value={String(week.bookings)} plain />
        {/* Where it goes, or that it waits: see `payoutDestination`. */}
        {destination ? (
          <div className="border-paper-line flex items-baseline justify-between gap-4 border-t pt-3">
            <dt className="text-forest/75 shrink-0">To your bank</dt>
            <dd className="min-w-0 text-right font-bold">
              {destination.kind === "held" ? (
                <span className="text-terra-deep">{heldLine}</span>
              ) : (
                <Link
                  href="/payouts"
                  className="decoration-forest/40 underline underline-offset-4"
                >
                  <AccountLine
                    line={destination.line}
                    ifsc={to?.ifsc ?? null}
                  />
                </Link>
              )}
            </dd>
          </div>
        ) : null}
      </dl>

      {/* Both hedges: without them this reads as a promise of a date. */}
      <p className="text-forest/70 leading-body mt-5 text-sm text-pretty">
        {nextSettlementNote(week.settlesFrom)}
      </p>
      <HelpLink id="how-payouts-work">How a payout is worked out</HelpLink>
    </Panel>
  );
}

/**
 * Card bookings still to run. Its own block, deliberately apart from the one
 * above: this figure is NEVER added to anything earned. The trips have not
 * happened, so the money is not owed, and nothing on this screen sums the two.
 */
export function BookedNotRun({ pipeline }: { pipeline: SettlementPipeline }) {
  return (
    <Panel
      tone="outline"
      className="mt-4"
      role="region"
      aria-labelledby="booked-not-run"
    >
      <h2 id="booked-not-run" className="label text-forest/75">
        Booked, not run yet
      </h2>
      <p className="font-board mt-3 text-2xl leading-none tabular-nums">
        {formatPaise(pipeline.netPaise)}
      </p>
      {/* The one sentence that stops it being read as owed. */}
      <p className="text-forest/70 leading-body mt-2 text-sm text-pretty">
        Not earned until the trip is marked.
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        <Row label="Bookings" value={String(pipeline.bookings)} plain />
      </dl>
    </Panel>
  );
}

/**
 * Cash taken and Yuvoy's share of it, summarised (op#96): the figures Cash
 * leads with, what is still to run, the trips nobody recorded, and the door to
 * all of it.
 *
 * Each figure is drawn only when its read answered. `GET /commission-owed` is
 * soft here, and a figure from a failed read is left unsaid rather than
 * drawn as ₹0. Nothing here is "owed": the share on completed trips counts
 * every one of them, billed or not and paid or not (op#121), so what is owed
 * is the commission block's alone.
 */
export function CashSection({ cash }: { cash: CashOnTheTab }) {
  const { unrecorded, toRun } = cash;
  const lead = cashLead(cash);
  const takenForToRun = toRun?.takenPaise ?? 0;
  return (
    <section className="mt-4" aria-labelledby="cash-summary">
      <div className={panelClass("outline")}>
        <h2 id="cash-summary" className="label text-forest/75">
          Cash
        </h2>
        {/*
          The largest REAL figure leads (#87 s15). It led with "₹0 recorded as
          taken from travellers" while the only real number, cash still to
          take on trips to run, was the smallest row. What they took comes
          first when there is any: Yuvoy's share then reads as a share of money
          already in their hand rather than a bill.
        */}
        {lead ? (
          <>
            <p className="font-board mt-3 text-2xl leading-none tabular-nums">
              {formatPaise(lead.paise)}
            </p>
            <p className="text-forest/70 mt-2 text-sm">
              {lead.kind === "in-hand"
                ? "recorded as taken from travellers"
                : lead.kind === "to-take"
                  ? "to take on cash trips still to run"
                  : "Yuvoy's share on completed trips"}
            </p>
          </>
        ) : null}
        {/*
          A failed read is said, never drawn as ₹0 and never left to become
          "Nothing owed either way yet" (the audit, M3).
        */}
        {!cash.cashKnown ? (
          <p className="text-forest/80 leading-body mt-3 text-sm text-pretty">
            We could not load your cash figures just now. Open Cash to try
            again.
          </p>
        ) : null}
        <dl className="mt-4 space-y-2 text-sm">
          {/* Zero is not news, so no row is drawn for it. */}
          {cash.completedShare !== null &&
          cash.completedShare > 0 &&
          lead?.kind !== "share" ? (
            <Row
              label="Yuvoy's share on completed trips"
              value={formatPaise(cash.completedShare)}
            />
          ) : null}
          {cash.heldShare !== null && cash.heldShare > 0 ? (
            <Row
              label="Yuvoy's share on trips still to run"
              value={formatPaise(cash.heldShare)}
            />
          ) : null}
          {toRun && toRun.bookings > 0 ? (
            <Row
              label="Cash trips still to run"
              value={`${toRun.bookings} · ${formatPaise(toRun.farePaise)}`}
            />
          ) : null}
          {/*
            Taken already for those trips, from the overview, so it is still
            said when `/commission-owed` failed and "in hand" cannot be.
          */}
          {toRun && takenForToRun > 0 ? (
            <Row
              label="Already taken for them"
              value={formatPaise(takenForToRun)}
            />
          ) : null}
        </dl>
        <HelpLink id="cash-not-in-payout">Why cash is not in a payout</HelpLink>
      </div>

      {/*
        Trips that ran with no cash recorded, in none of the figures above:
        they used to be counted as still to run, which is how 7 past trips read
        as ₹60,000 of bookings to come (op#96). The one thing here that needs
        doing, so it is a way straight to the list.
      */}
      {unrecorded ? (
        <Link
          href="/cash#unrecorded"
          className={panelClass(
            "alert",
            "ease-interaction hover:bg-paper mt-2 flex min-h-14 items-center justify-between gap-4 p-4 transition-colors duration-200",
          )}
        >
          <span className="min-w-0">
            <span className="block text-base font-bold text-balance">
              {unrecorded.bookings === 1
                ? "1 past cash trip has no payment recorded"
                : `${unrecorded.bookings} past cash trips have no payment recorded`}
            </span>
            {unrecorded.farePaise !== null ? (
              <span className="text-forest/80 mt-0.5 block text-sm">
                {formatPaise(unrecorded.farePaise)} in fares
              </span>
            ) : null}
          </span>
          <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
        </Link>
      ) : null}

      <Door
        href="/cash"
        icon={BanknoteIcon}
        label="Cash you've collected"
        className="mt-2"
      />
    </section>
  );
}
