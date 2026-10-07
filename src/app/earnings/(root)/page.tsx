import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { requireOperator } from "@/lib/auth/session";
import {
  getChangeRequests,
  getSettlementOverview,
  listSettlements,
  readCommissionOwed,
  readCommissionStatements,
} from "@/lib/money/fetch";
import {
  payoutDestination,
  payoutHold,
  type ChangeRequest,
} from "@/lib/money/earnings";
import { heldDestinationLine } from "@/lib/money/payouts-held";
import { accountOnFile, type OnFile } from "@/lib/account/bank";
import { canManageAccess } from "@/lib/team/access";
import {
  SETTLEMENT_STATE_LABEL,
  isOwedBack,
  nextSettlementNote,
  showsAdjustments,
  weekLabel,
  type Settlement,
  type SettlementPipeline,
  type SettlementWeek,
} from "@/lib/money/settlements";
import {
  cashLead,
  cashOnTheTab,
  commissionOnTheTab,
  latestStatement,
  moneyBlocks,
  pageCursor,
  seasonLine,
  type CashOnTheTab,
  type CommissionOnTheTab,
} from "@/lib/money/overview";
import {
  statementsForMoney,
  statementsOwing,
} from "@/lib/money/commission-statements";
import { formatPaise } from "@/lib/format/money";
import { helpHref } from "@/lib/help";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { AccountLine } from "@/components/account/account-line";
import { Panel, panelClass } from "@/components/ui/panel";
import {
  BankIcon,
  BanknoteIcon,
  ChevronRightIcon,
} from "@/components/ui/icons";
import { LinkRing } from "@/components/ui/link-pending";
import { cn } from "@/lib/cn";
import { DownloadStatement } from "@/app/earnings/[id]/download-statement";
import { StatementRow } from "@/app/earnings/commission/statement-row";

export const metadata: Metadata = { title: "Money" };

/*
  Never prerendered, never cached. A figure that can still move must not be
  served from a cache that cannot.
*/
export const dynamic = "force-dynamic";

/**
 * Money: a tab of its own since yuvoy-operator#96.
 *
 * "Money is three taps away (Business, Settings, Money), next to Logo and
 * Notifications. For the operator it is the second reason to open the app."
 * This is the tab: what is owed to Yuvoy on the weekly commission statements
 * (op#121), what Yuvoy will pay, what is booked and not yet earned, the cash
 * taken, past payouts, the latest statement, and the way to the bank details.
 *
 * ## What it leads with
 *
 * "The screen leads with ₹0, and the only real number, ₹55,250 of cash still
 * to collect, is third and smallest" (op#87 s15). So each block says whether
 * it has anything in it (`lib/money/overview.ts`), the ones that do are drawn
 * first, the next payout's card moves below them when it is empty, and a week
 * where nothing has money in it is said once, in words.
 *
 * ## The one rule this screen exists to hold
 *
 * **The pipeline is never earned.** `pipeline.netPaise` is card bookings still
 * to run, and the contract says it "is **never** part of anything earned". It
 * has its own block and its own sentence, and no total anywhere on this screen
 * includes it. Cash is the same shape for a different reason: the traveller
 * pays the operator directly, so it "never passes through a settlement". Its
 * detail is `/cash`, which this summarises rather than restates.
 *
 * ## Read-only
 *
 * The only control is downloading the statement of a payout already sent.
 * Nothing on this screen can change what anybody is paid. A commission
 * statement is paid from its own page, in the operator's own UPI app.
 */
export default async function MoneyPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string | string[] }>;
}) {
  const { token, me } = await requireOperator();

  /*
    Refused before the request, not after it.

    Every settlement endpoint "Requires OWNER, ADMIN or MANAGER" and answers
    403 to a staff login. Making the call anyway put the throw on the error
    boundary, which says "That did not load, try again": false, and
    unactionable, because nothing went wrong. The tab is not offered to a staff
    login; this is for the URL typed or kept from before.
  */
  if (!me.canManage) {
    return (
      <Screen nav="tabs">
        <h1 className="font-display tracking-display leading-display text-4xl text-balance">
          Money
        </h1>
        <div className="mt-6">
          <Problem
            title="Only owners, admins and managers can see what the business is paid"
            body="Ask an owner, an admin or a manager if you need a figure."
          />
        </div>
      </Screen>
    );
  }

  const { cursor: askedCursor } = await searchParams;
  const cursor = pageCursor(askedCursor);

  /*
    The overview is HARD: it is the top of the screen, and four figures that
    quietly render as zero because a request failed is the one wrong answer
    that must never appear. Everything else is soft and costs only its own
    section: the hold warning, the history, the cash summary, and the
    commission statements.
  */
  const [overview, changes, past, cashTaken, statements] = await Promise.all([
    getSettlementOverview(token),
    getChangeRequests(token),
    listSettlements(token, cursor),
    readCommissionOwed(token),
    readCommissionStatements(token),
  ]);

  const hold = payoutHold(changes);
  /*
    What the next payout's bank row says while it is held: by the change list,
    or by the payout run itself (`payoutsHeld` on `/me`), which also holds
    after a new account goes live until we have updated the bank we pay from
    (yuvoy-operator#156).
  */
  const heldLine = heldDestinationLine(Boolean(hold), me.payoutsHeld);
  // The bank details, said on their door: "account ending 4412" (op#96).
  const onFile = accountOnFile(changes);
  const { nextSettlement, pipeline, paidAtCounter, seasonToDate } = overview;
  const cash = cashOnTheTab(paidAtCounter, cashTaken);
  const bill = commissionOnTheTab(statements);
  // What is real is drawn first; see `moneyBlocks` for the order and why.
  const blocks = moneyBlocks(nextSettlement, pipeline, cash, bill);

  const season = seasonLine(seasonToDate);
  // The newest statement, offered on the first page only: a later page's
  // newest is not the business's newest.
  const statement = past && !cursor ? latestStatement(past.items) : null;

  return (
    <Screen nav="tabs">
      <h1 className="font-display tracking-display leading-display text-4xl text-balance">
        Money
      </h1>

      {/*
        A payout held by a bank change in flight. Above everything, because it
        changes what every figure below means: owed, and not moving.
      */}
      {hold ? (
        <HoldWarning hold={hold} canStop={canManageAccess(me.roles)} />
      ) : null}

      {blocks.map((block) => {
        switch (block) {
          case "commission":
            return <CommissionToPay key={block} bill={bill} />;
          case "commission-unknown":
            /*
              Said, never drawn as nothing owed, and in the place a failure
              costs nothing above it: the figures around it are still right.
            */
            return (
              <div key={block} className="mt-4">
                <Problem
                  title="We could not load your commission statements"
                  body="The other figures here are still correct. Try again in a moment."
                />
              </div>
            );
          case "commission-quiet":
            return <SettledStatements key={block} bill={bill} />;
          case "nothing-yet":
            /*
              Said once, in words. Three panels opening on ₹0 read as a screen
              that failed to load, and answer "what am I owed" with three
              zeroes.
            */
            return (
              <Panel key={block} className="mt-6">
                <p className="text-lg font-bold text-balance">
                  Nothing owed either way yet
                </p>
              </Panel>
            );
          case "payout":
            return (
              <NextPayout
                key={block}
                week={nextSettlement}
                to={onFile}
                heldLine={heldLine}
              />
            );
          case "booked":
            return <BookedNotRun key={block} pipeline={pipeline} />;
          case "cash":
            return <CashSection key={block} cash={cash} />;
          case "payout-quiet":
            /*
              The next payout, kept below when it is empty ("keep the
              settlement card, but below") and said in words rather than as a
              ₹0.
            */
            return (
              <p key={block} className="text-forest/80 mt-4 text-sm">
                {`Next payout, ${weekLabel(
                  nextSettlement.periodStart,
                  nextSettlement.periodEnd,
                )}: nothing to pay yet.`}
              </p>
            );
        }
      })}

      <section className="mt-10" aria-labelledby="past-payouts">
        <h2
          id="past-payouts"
          className="font-display tracking-display leading-display text-2xl text-balance"
        >
          Past payouts
        </h2>
        {season ? (
          <p className="text-forest/80 mt-2 text-sm">{season}</p>
        ) : null}

        {/*
          `null` is "we could not load it" and `[]` is "there are none": two
          different sentences, and a list that could not load must not take the
          figures above it down with it.
        */}
        {past === null ? (
          <div className="mt-4">
            <Problem
              title="We could not load your past payouts"
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
            {cursor ? (
              /*
                A later page shows that page alone, so the way back to the
                newest weeks is said rather than left to the back button.
              */
              <Link
                href="/earnings"
                className="text-terra-deep mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
              >
                Back to the latest payouts
              </Link>
            ) : null}
            <ul className="mt-4 space-y-3">
              {past.items.map((settlement) => (
                <li key={settlement.id}>
                  <SettlementRow settlement={settlement} />
                </li>
              ))}
            </ul>

            {/*
              "Show more" while there is more, and `complete` is what says so.
              The contract is explicit: "Told rather than inferred. Do not
              infer the end from a short page." A link rather than a button,
              because this page is server-rendered and paging is a navigation.
            */}
            {!past.complete && past.nextCursor ? (
              <Link
                href={`/earnings?cursor=${encodeURIComponent(past.nextCursor)}`}
                className="text-terra-deep mt-4 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
              >
                Show more
              </Link>
            ) : null}
          </>
        )}
      </section>

      {statement ? <LatestStatement settlement={statement} /> : null}

      {/*
        The doors. Cash is here only when the section above did not draw its
        own; the bank details are always the last thing on the tab.
      */}
      <div className="mt-10 space-y-2">
        {!blocks.includes("cash") ? (
          <Door
            href="/cash"
            icon={BanknoteIcon}
            label="Cash you've collected"
          />
        ) : null}
        <Door
          href="/payouts"
          icon={BankIcon}
          label="Payout details"
          detail={
            onFile ? (
              <AccountLine line={onFile.line} ifsc={onFile.ifsc} />
            ) : undefined
          }
        />
      </div>
    </Screen>
  );
}

/**
 * The bank change holding the payout. The original sentences, which say the
 * two things an operator can act on: which stage the change is at, and that
 * they can stop it if they did not ask for it.
 */
function HoldWarning({
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
function NextPayout({
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
function BookedNotRun({ pipeline }: { pipeline: SettlementPipeline }) {
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
function CashSection({ cash }: { cash: CashOnTheTab }) {
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

/**
 * What is owed to Yuvoy on the weekly commission statements (op#121, D-043),
 * with the statements behind it: every one with something still to pay,
 * however old, then the newest settled (`statementsForMoney`). Each opens on
 * its trips and the way to pay it.
 *
 * First on the tab when it is drawn. It is the one thing here that needs
 * doing, and the email that comes with each statement sends people here.
 */
function CommissionToPay({ bill }: { bill: CommissionOnTheTab }) {
  const { shown, more } = statementsForMoney(bill.statements, 3);
  const owing = statementsOwing(bill.statements);
  return (
    <section className="mt-6" aria-labelledby="commission-to-pay">
      <div className={panelClass("raised")}>
        <h2 id="commission-to-pay" className="label text-forest/75">
          Commission to pay
        </h2>
        {bill.owedPaise !== null ? (
          <>
            {/* A figure on the board, as the next payout's is (v3.2). */}
            <p className="font-board mt-3 text-4xl leading-none tabular-nums">
              {formatPaise(bill.owedPaise)}
            </p>
            <p className="text-forest/70 mt-2 text-sm">
              {owing === 1
                ? "owed to Yuvoy on 1 statement"
                : `owed to Yuvoy on ${owing} statements`}
            </p>
          </>
        ) : (
          /*
            A total over a list cut short, or over a statement that will not
            say what it owes, understates the bill. Each row still says.
          */
          <p className="text-forest/80 leading-body mt-3 text-sm text-pretty">
            We could not add up what is owed. Each statement below says what is
            left to pay on it.
          </p>
        )}
        <HelpLink id="settling-cash">How to pay a statement</HelpLink>
      </div>
      <ul className="mt-2 space-y-2">
        {shown.map((statement) => (
          <li key={statement.id}>
            <StatementRow statement={statement} />
          </li>
        ))}
      </ul>
      {more > 0 ? <AllStatements /> : null}
    </section>
  );
}

/**
 * Statements with nothing left to pay on any of them: below the blocks,
 * because a bill already paid is a record rather than news, and said in
 * words rather than as a ₹0.
 */
function SettledStatements({ bill }: { bill: CommissionOnTheTab }) {
  const { shown, more } = statementsForMoney(bill.statements, 3);
  return (
    <section className="mt-10" aria-labelledby="commission-statements">
      <h2
        id="commission-statements"
        className="font-display tracking-display leading-display text-2xl text-balance"
      >
        Commission statements
      </h2>
      <p className="text-forest/80 mt-2 text-sm">Nothing to pay.</p>
      <ul className="mt-4 space-y-3">
        {shown.map((statement) => (
          <li key={statement.id}>
            <StatementRow statement={statement} />
          </li>
        ))}
      </ul>
      {more > 0 ? <AllStatements /> : null}
    </section>
  );
}

function AllStatements() {
  return (
    <Link
      href="/earnings/commission"
      className="text-terra-deep mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
    >
      All statements
    </Link>
  );
}

/**
 * The newest payout statement, one tap from the tab rather than two. Named a
 * payout statement since the commission statements share the tab (op#121):
 * one is what Yuvoy paid, the other what the business owes.
 */
function LatestStatement({ settlement }: { settlement: Settlement }) {
  return (
    <Panel className="mt-6" role="region" aria-labelledby="latest-statement">
      <h2 id="latest-statement" className="label text-forest/75">
        Latest payout statement
      </h2>
      <p className="mt-1 text-base font-bold text-balance">
        {weekLabel(settlement.periodStart, settlement.periodEnd)}
      </p>
      <DownloadStatement id={settlement.id} className="mt-4" />
      <p className="text-forest/70 leading-body mt-3 text-sm text-pretty">
        Older payout statements are on each paid week&rsquo;s page.
      </p>
    </Panel>
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
        {/* The ring follows the week, so the figure never moves under it. */}
        <p className="font-bold text-balance">
          {weekLabel(settlement.periodStart, settlement.periodEnd)}
          <LinkRing />
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

/**
 * A way into a screen behind Money: an icon, a label, a chevron. Cash wears a
 * banknote and nothing else here wears coins, so the two never read as one
 * row twice (op#88 s12).
 */
function Door({
  href,
  icon: Icon,
  label,
  detail,
  className,
}: {
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  /** A fact about what is behind it, under the label: the account on file. */
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={panelClass(
        "raised",
        cn(
          "ease-interaction hover:bg-paper flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-200",
          className,
        ),
      )}
    >
      <span className="flex min-w-0 items-center gap-3">
        <Icon className="text-terra-deep size-5 shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-base font-bold">{label}</span>
          {detail ? (
            <span className="text-forest/70 block truncate text-sm">
              {detail}
            </span>
          ) : null}
        </span>
      </span>
      <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
    </Link>
  );
}

/**
 * A small way to the answer, for the one idea on a block that is genuinely not
 * obvious (op#80 t4). The explanation lives in Help; the screen keeps the
 * figures.
 */
function HelpLink({ id, children }: { id: string; children: string }) {
  return (
    <Link
      href={helpHref(id, "/earnings")}
      className="text-forest/80 hover:text-forest mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
    >
      {children}
    </Link>
  );
}
