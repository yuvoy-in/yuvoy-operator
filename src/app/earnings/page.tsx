import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType } from "react";
import { requireOperator } from "@/lib/auth/session";
import {
  getChangeRequests,
  getSettlementOverview,
  listSettlements,
  readCommissionOwed,
} from "@/lib/money/fetch";
import { payoutHold, type ChangeRequest } from "@/lib/money/earnings";
import { accountOnFile } from "@/lib/account/bank";
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
  cashOnTheTab,
  latestStatement,
  moneyBlocks,
  pageCursor,
  seasonLine,
  type CashOnTheTab,
} from "@/lib/money/overview";
import { formatPaise } from "@/lib/format/money";
import { helpHref } from "@/lib/help";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Panel, panelClass } from "@/components/ui/panel";
import {
  BankIcon,
  BanknoteIcon,
  ChevronRightIcon,
} from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { DownloadStatement } from "./[id]/download-statement";

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
 * This is the tab: what Yuvoy will pay, what is booked and not yet earned,
 * the cash held and owed, past payouts, the latest statement, and the way to
 * the bank details.
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
 * Nothing on this screen can change what anybody is paid.
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
        <h1 className="font-display tracking-display text-4xl leading-[1.05]">
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
    section: the hold warning, the history, and the cash summary.
  */
  const [overview, changes, past, commission] = await Promise.all([
    getSettlementOverview(token),
    getChangeRequests(token),
    listSettlements(token, cursor),
    readCommissionOwed(token),
  ]);

  const hold = payoutHold(changes);
  // The bank details, said on their door: "account ending 4412" (op#96).
  const onFile = accountOnFile(changes);
  const { nextSettlement, pipeline, paidAtCounter, seasonToDate } = overview;
  const cash = cashOnTheTab(paidAtCounter, commission);
  // What is real is drawn first; see `moneyBlocks` for the order and why.
  const blocks = moneyBlocks(nextSettlement, pipeline, cash);

  const season = seasonLine(seasonToDate);
  // The newest statement, offered on the first page only: a later page's
  // newest is not the business's newest.
  const statement = past && !cursor ? latestStatement(past.items) : null;

  return (
    <Screen nav="tabs">
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Money
      </h1>

      {/*
        A payout held by a bank change in flight. Above everything, because it
        changes what every figure below means: owed, and not moving.
      */}
      {hold ? <HoldWarning hold={hold} /> : null}

      {blocks.map((block) => {
        switch (block) {
          case "nothing-yet":
            /*
              Said once, in words. Three panels opening on ₹0 read as a screen
              that failed to load, and answer "what am I owed" with three
              zeroes.
            */
            return (
              <Panel key={block} className="mt-6">
                <p className="text-lg font-bold">Nothing owed either way yet</p>
              </Panel>
            );
          case "payout":
            return <NextPayout key={block} week={nextSettlement} />;
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
          className="font-display tracking-display text-2xl leading-tight"
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
          detail={onFile?.line}
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
function HoldWarning({ hold }: { hold: ChangeRequest }) {
  const stage =
    hold.state === "cooling"
      ? "approved and waiting out its cooling period"
      : hold.state === "objection_window"
        ? "in its objection window: you can still stop it"
        : "awaiting review";
  return (
    <Panel tone="alert" className="mt-6 p-6">
      <p className="text-terra-deep text-base font-bold">
        Payouts are on hold while your bank change is reviewed
      </p>
      <p className="text-forest/80 mt-2 text-sm">
        {hold.summary ?? "A bank change"} is {stage}. Nothing is paid out until
        it settles. If you did not request this, stop it now from{" "}
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

/** What Yuvoy will pay for the week, with the arithmetic behind it. */
function NextPayout({ week }: { week: SettlementWeek }) {
  const owedBack = isOwedBack(week.netPaise);
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
          "font-display tracking-display mt-4 text-4xl leading-none",
          owedBack && "text-terra-deep",
        )}
      >
        {formatPaise(week.netPaise)}
      </p>
      {owedBack ? (
        <p className="text-terra-deep mt-2 text-sm">
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
      </dl>

      {/* Both hedges: without them this reads as a promise of a date. */}
      <p className="text-forest/70 mt-5 text-sm">
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
      <p className="font-display tracking-display mt-3 text-2xl leading-none">
        {formatPaise(pipeline.netPaise)}
      </p>
      {/* The one sentence that stops it being read as owed. */}
      <p className="text-forest/70 mt-2 text-sm">
        Not earned until the trip is marked.
      </p>
      <dl className="mt-4 space-y-2 text-sm">
        <Row label="Bookings" value={String(pipeline.bookings)} plain />
      </dl>
    </Panel>
  );
}

/**
 * Cash held and owed, summarised (op#96): the figures Cash leads with, what is
 * still to run, the trips nobody recorded, and the door to all of it.
 *
 * Each figure is drawn only when its read answered. `GET /commission-owed` is
 * soft here, and a figure from a failed read is left unsaid rather than
 * drawn as ₹0.
 */
function CashSection({ cash }: { cash: CashOnTheTab }) {
  const { unrecorded } = cash;
  return (
    <section className="mt-4" aria-labelledby="cash-summary">
      <div className={panelClass("outline")}>
        <h2 id="cash-summary" className="label text-forest/75">
          Cash
        </h2>
        {/*
          What they took, first. Yuvoy's share then reads as a share of money
          already in their hand rather than a bill: the order the Cash screen
          argues for.
        */}
        {cash.inHand !== null ? (
          <>
            <p className="font-display tracking-display mt-3 text-2xl leading-none">
              {formatPaise(cash.inHand)}
            </p>
            <p className="text-forest/70 mt-2 text-sm">
              recorded as taken from travellers
            </p>
          </>
        ) : null}
        <dl className="mt-4 space-y-2 text-sm">
          {cash.owedNow !== null ? (
            <Row
              label="Yuvoy's share, owed now"
              value={formatPaise(cash.owedNow)}
            />
          ) : null}
          {cash.heldShare !== null && cash.heldShare > 0 ? (
            <Row
              label="Yuvoy's share on trips still to run"
              value={formatPaise(cash.heldShare)}
            />
          ) : null}
          {cash.toRun.bookings > 0 ? (
            <Row
              label="Cash trips still to run"
              value={`${cash.toRun.bookings} · ${formatPaise(
                cash.toRun.farePaise,
              )}`}
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
            <span className="block text-base font-bold">
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

/** The newest statement, one tap from the tab rather than two. */
function LatestStatement({ settlement }: { settlement: Settlement }) {
  return (
    <Panel className="mt-6" role="region" aria-labelledby="latest-statement">
      <h2 id="latest-statement" className="label text-forest/75">
        Latest statement
      </h2>
      <p className="mt-1 text-base font-bold">
        {weekLabel(settlement.periodStart, settlement.periodEnd)}
      </p>
      <DownloadStatement id={settlement.id} className="mt-4" />
      <p className="text-forest/70 mt-3 text-sm">
        Older statements are on each paid week&rsquo;s page.
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
  detail?: string;
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
      href={helpHref(id)}
      className="text-forest/80 hover:text-forest mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
    >
      {children}
    </Link>
  );
}
