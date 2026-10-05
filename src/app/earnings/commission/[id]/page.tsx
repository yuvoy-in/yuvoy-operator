import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getCommissionStatement } from "@/lib/money/fetch";
import { OperatorApiError } from "@/lib/api/errors";
import {
  owedOf,
  payee,
  paymentsAddUp,
  rateLabel,
  statementLinesAddUp,
  statementState,
  statementStateLine,
  upiPayLink,
} from "@/lib/money/commission-statements";
import { dayWithWeekday, weekLabel } from "@/lib/money/settlements";
import { formatPaise } from "@/lib/format/money";
import { marketDateLabel } from "@/lib/format/market-time";
import { dedashText } from "@/lib/format/dedash";
import { helpHref } from "@/lib/help";
import { SUPPORT_PHONE } from "@/lib/site/contact";
import { Chip } from "@/components/ui/chip";
import { Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Panel, panelClass } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { PayPanel } from "./pay-panel";

export const metadata: Metadata = { title: "Commission statement" };
export const dynamic = "force-dynamic";

/* Back to the tab the statements are listed on, as a payout's page does. */
const BACK = { href: "/earnings", label: "Money" };

/**
 * One weekly commission statement (yuvoy-operator#121, D-043): its cash
 * trips, the payments recorded against it, what is still owed, and the way
 * to pay that.
 *
 * ## Every rupee is checkable, or the screen says it is not
 *
 * "A bill that first appears as a demand gets argued about. One that has been
 * visible all along, with the trips behind it listed, gets paid" (op#40). So
 * every trip carries its reference, day, guests, fare, rate and commission,
 * and when the trips or the payments do not account for the statement's own
 * figures, the screen says so and offers no way to pay a figure it cannot
 * reconcile.
 *
 * ## Settled is not paid
 *
 * `waived` is Yuvoy deciding not to collect what was left. It reads as
 * settled, with nothing to pay, and the part not collected is its own row so
 * the arithmetic still closes.
 */
export default async function CommissionStatementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { token, me } = await requireOperator();

  if (!me.canManage) {
    return (
      <Screen nav={{ back: BACK }}>
        <h1 className="font-display tracking-display leading-display text-3xl text-balance">
          Commission statement
        </h1>
        <div className="mt-6">
          <Problem
            title="Only owners, admins and managers can see what the business owes"
            body="Ask an owner, an admin or a manager if you need a figure."
          />
        </div>
      </Screen>
    );
  }

  let statement: Awaited<ReturnType<typeof getCommissionStatement>>;
  try {
    statement = await getCommissionStatement(token, id);
  } catch (err) {
    /*
      Another business's statement answers 404, exactly as one that does not
      exist. `notFound()` rather than the error boundary: a bill somebody
      cannot see is not a fault they can retry.
    */
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  const state = statementState(statement);
  const owed = owedOf(statement);
  const owing = owed !== null && owed > 0;
  const lines = statement.lines ?? [];
  const payments = statement.payments ?? [];
  const linesAddUp = statementLinesAddUp(statement, lines);
  const paidAddsUp = paymentsAddUp(statement, payments);
  /* What was left when Yuvoy settled it, so the figures still close. */
  const notCollected =
    statement.state === "waived"
      ? Math.max(0, statement.commissionPaise - statement.paidPaise)
      : 0;
  const payTo = statement.payTo ?? { available: false };

  return (
    <Screen nav={{ back: BACK }}>
      <h1 className="font-display tracking-display leading-display text-3xl text-balance">
        {weekLabel(statement.weekStart, statement.weekEnd)}
      </h1>
      <p className="text-forest/80 mt-2 text-base">
        {statementStateLine(statement)}
      </p>

      <Panel className="mt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/* On the board, as every figure on Money is (v3.2). */}
            <p className="font-board text-4xl leading-none tabular-nums">
              {formatPaise(owing ? owed : statement.commissionPaise)}
            </p>
            <p className="text-forest/70 mt-2 text-sm">
              {owing ? "still to pay" : "commission billed"}
            </p>
          </div>
          <Chip tone={state.tone}>{state.label}</Chip>
        </div>

        <dl className="mt-5 space-y-2 text-sm">
          <Row label="Cash trips" value={String(statement.bookings)} plain />
          <Row label="Fares" value={formatPaise(statement.farePaise)} />
          <Row
            label="Commission"
            value={formatPaise(statement.commissionPaise)}
          />
          {/* Zero is not news on a bill nobody has paid yet. */}
          {statement.paidPaise > 0 ? (
            <Row label="Paid" value={formatPaise(statement.paidPaise)} />
          ) : null}
          {notCollected > 0 ? (
            <Row label="Not collected" value={formatPaise(notCollected)} />
          ) : null}
          {owing ? (
            <Row label="Still to pay" value={formatPaise(owed)} />
          ) : null}
        </dl>

        <div className="border-paper-line mt-5 border-t pt-4">
          <dl className="space-y-2 text-sm">
            <Row
              label="Reference"
              value={statement.reference}
              plain
              reference
            />
          </dl>
        </div>
      </Panel>

      {/*
        The way to pay, only for a figure the screen can stand behind. When
        the trips or the payments do not account for the statement, paying it
        would settle a number nobody can check, so the problem below says to
        call instead.
      */}
      {owing && linesAddUp && paidAddsUp ? (
        <PayPanel
          owedPaise={owed}
          reference={statement.reference}
          link={upiPayLink(payTo, owed)}
          to={payee(payTo)}
          message={
            payTo.available ? null : dedashText(payTo.message?.trim() || null)
          }
        />
      ) : null}
      {owed === null ? (
        <div className="mt-4">
          <Problem
            title="We could not read what is left to pay"
            body={`Do not pay against this statement yet. Call us on ${SUPPORT_PHONE} with its reference, ${statement.reference}, and we will tell you.`}
          />
        </div>
      ) : null}

      <section className="mt-10" aria-labelledby="statement-trips">
        <h2
          id="statement-trips"
          className="font-display tracking-display leading-display text-2xl text-balance"
        >
          Trips on this statement
        </h2>
        {!linesAddUp ? (
          <div className="mt-4">
            <Problem
              title="These trips do not add up to the statement"
              body={`The trips listed do not account for the commission billed. Do not pay against this. Call us on ${SUPPORT_PHONE} with its reference, ${statement.reference}, and we will find it.`}
            />
          </div>
        ) : null}
        {lines.length > 0 ? (
          <ul className="mt-4 space-y-3">
            {lines.map((line, i) => (
              <li
                key={`${line.bookingReference}-${i}`}
                className={panelClass("outline")}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="tracking-ref text-base font-bold slashed-zero tabular-nums">
                    {line.bookingReference || "-"}
                  </p>
                  <p className="text-forest/70 shrink-0 text-sm">
                    {dayWithWeekday(line.tripDate)}
                  </p>
                </div>
                <p className="text-forest/70 mt-1 text-sm">
                  {line.guests === 1 ? "1 guest" : `${line.guests} guests`}
                </p>
                <dl className="mt-3 space-y-1.5 text-sm">
                  <Row label="Fare" value={formatPaise(line.farePaise)} />
                  <Row
                    label="Rate"
                    value={rateLabel(line.commissionRateBps)}
                    plain
                  />
                  <Row
                    label="Commission"
                    value={formatPaise(line.commissionPaise)}
                  />
                </dl>
                {/*
                  Only when it disagrees with the fare: the commission is on
                  the fare, not on what they chose to take, and this explains
                  the figure rather than contradicting it.
                */}
                {Number.isInteger(line.collectedPaise) &&
                line.collectedPaise !== line.farePaise ? (
                  <p className="text-forest/70 leading-body mt-2 text-sm text-pretty">
                    You recorded taking {formatPaise(line.collectedPaise)}. The
                    commission is worked out on the fare.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mt-10" aria-labelledby="statement-payments">
        <h2
          id="statement-payments"
          className="font-display tracking-display leading-display text-2xl text-balance"
        >
          Payments received
        </h2>
        {!paidAddsUp ? (
          <div className="mt-4">
            <Problem
              title="These payments do not add up to what is paid"
              body={`The payments listed do not account for the amount recorded as paid. Do not pay against this. Call us on ${SUPPORT_PHONE} with its reference, ${statement.reference}, and we will find it.`}
            />
          </div>
        ) : null}
        {payments.length === 0 ? (
          <p className="text-forest/70 leading-body mt-3 text-sm text-pretty">
            {owing ? "Nothing received yet." : "None recorded."}
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {payments.map((payment, i) => (
              <li key={`${payment.utr}-${i}`} className={panelClass("outline")}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-base font-bold tabular-nums">
                    {formatPaise(payment.amountPaise)}
                  </p>
                  <p className="text-forest/70 shrink-0 text-sm">
                    {`Received ${marketDateLabel(payment.receivedOn)}`}
                  </p>
                </div>
                <p className="text-forest/70 mt-1 text-sm">
                  UPI transaction ID{" "}
                  <span className="text-forest tracking-ref slashed-zero tabular-nums select-all">
                    {payment.utr}
                  </span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="border-paper-line mt-10 border-t pt-4">
        <HelpLink id="settling-cash" from={`/earnings/commission/${id}`}>
          How to pay a statement
        </HelpLink>
        <HelpLink id="statement-states" from={`/earnings/commission/${id}`}>
          What each state means
        </HelpLink>
      </div>
    </Screen>
  );
}

function Row({
  label,
  value,
  plain,
  reference,
}: {
  label: string;
  value: string;
  plain?: boolean;
  /**
   * The statement's reference, set as every reference is, so a 0 in it never
   * passes for an O (v3.2).
   */
  reference?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-forest/75">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          !plain && "font-bold",
          reference && "tracking-ref slashed-zero",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** A small way to the answer, carrying this statement as the way back. */
function HelpLink({
  id,
  from,
  children,
}: {
  id: string;
  from: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={helpHref(id, from)}
      className="text-forest/80 hover:text-forest mr-6 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
    >
      {children}
    </Link>
  );
}
