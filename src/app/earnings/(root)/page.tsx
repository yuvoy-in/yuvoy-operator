import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import {
  getChangeRequests,
  getSettlementOverview,
  listSettlements,
  readCommissionOwed,
  readCommissionStatements,
} from "@/lib/money/fetch";
import { payoutHold } from "@/lib/money/earnings";
import { heldDestinationLine } from "@/lib/money/payouts-held";
import { accountOnFile } from "@/lib/account/bank";
import { canManageAccess } from "@/lib/team/access";
import { weekLabel } from "@/lib/money/settlements";
import {
  cashOnTheTab,
  commissionOnTheTab,
  latestStatement,
  moneyBlocks,
  pageCursor,
  seasonLine,
} from "@/lib/money/overview";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { AccountLine } from "@/components/account/account-line";
import { Panel } from "@/components/ui/panel";
import { BankIcon, BanknoteIcon } from "@/components/ui/icons";
import {
  HoldWarning,
  NextPayout,
  BookedNotRun,
  CashSection,
} from "./earnings-sections";
import {
  CommissionToPay,
  SettledStatements,
  LatestStatement,
  SettlementRow,
  Door,
} from "./earnings-parts";

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
