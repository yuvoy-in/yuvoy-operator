/**
 * The money page's commission and statements, and the rows and links the
 * sections share. Moved out of page.tsx (yuvoy-operator#178).
 */
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import {
  SETTLEMENT_STATE_LABEL,
  isOwedBack,
  weekLabel,
  type Settlement,
} from "@/lib/money/settlements";
import type { CommissionOnTheTab } from "@/lib/money/overview";
import {
  statementsForMoney,
  statementsOwing,
} from "@/lib/money/commission-statements";
import { formatPaise } from "@/lib/format/money";
import { helpHref } from "@/lib/help";
import { Panel, panelClass } from "@/components/ui/panel";
import { ChevronRightIcon } from "@/components/ui/icons";
import { LinkRing } from "@/components/ui/link-pending";
import { cn } from "@/lib/cn";
import { DownloadStatement } from "@/app/earnings/[id]/download-statement";
import { StatementRow } from "@/app/earnings/commission/statement-row";

/**
 * What is owed to Yuvoy on the weekly commission statements (op#121, D-043),
 * with the statements behind it: every one with something still to pay,
 * however old, then the newest settled (`statementsForMoney`). Each opens on
 * its trips and the way to pay it.
 *
 * First on the tab when it is drawn. It is the one thing here that needs
 * doing, and the email that comes with each statement sends people here.
 */
export function CommissionToPay({ bill }: { bill: CommissionOnTheTab }) {
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
export function SettledStatements({ bill }: { bill: CommissionOnTheTab }) {
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
export function LatestStatement({ settlement }: { settlement: Settlement }) {
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
export function Row({
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

export function SettlementRow({ settlement }: { settlement: Settlement }) {
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
export function Door({
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
export function HelpLink({ id, children }: { id: string; children: string }) {
  return (
    <Link
      href={helpHref(id, "/earnings")}
      className="text-forest/80 hover:text-forest mt-3 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
    >
      {children}
    </Link>
  );
}
