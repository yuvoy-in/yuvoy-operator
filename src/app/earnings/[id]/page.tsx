import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { getSettlement } from "@/lib/money/fetch";
import { OperatorApiError } from "@/lib/api/errors";
import {
  SETTLEMENT_STATE_LABEL,
  hasStatement,
  isOwedBack,
  showsAdjustments,
  weekLabel,
  dayWithWeekday,
} from "@/lib/money/settlements";
import { formatPaise } from "@/lib/format/money";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import { DownloadStatement } from "./download-statement";

export const metadata: Metadata = { title: "Settlement" };
export const dynamic = "force-dynamic";

const BACK = { href: "/earnings", label: "earnings" };

/**
 * One payout week, and the bookings it paid — yuvoy-operator#47 item 6.
 *
 * ## The lines are frozen, and the total may not match them
 *
 * The contract is explicit and this is the trap: "`adjustmentsPaise` is on the
 * settlement and on no line", and the statement's total "includes any
 * adjustment, which has no column of its own, so when there is one the rows'
 * nets do not add up to it by exactly `adjustmentsPaise`."
 *
 * An operator adding the rows up and finding a different number is the most
 * likely reason somebody messages us about this screen. So the correction is
 * shown ONCE at the top, before the rows, where it explains the gap rather than
 * being discovered as one.
 */
export default async function SettlementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { token, me } = await requireOperator();

  if (!me.canManage) {
    return (
      <Screen nav={{ back: BACK }} stageLabel="Settlement">
        <h1 className="font-display tracking-display text-3xl leading-tight">
          Settlement
        </h1>
        <div className="mt-6">
          <Problem
            title="Only owners, admins and managers can see what the business is paid"
            body="A staff login runs the day and does not carry what the business is owed. Ask an owner, an admin or a manager if you need the figure."
          />
        </div>
      </Screen>
    );
  }

  let settlement: Awaited<ReturnType<typeof getSettlement>>;
  try {
    settlement = await getSettlement(token, id);
  } catch (err) {
    /*
      Another business's settlement answers 404, and so does one that does not
      exist. `notFound()` rather than the error boundary: a payout somebody
      cannot see is not a fault they can retry, and "that did not load, try
      again" would send them round a loop.
    */
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  const lines = settlement.lines ?? [];

  return (
    <Screen nav={{ back: BACK }} stageLabel="Settlement">
      <p className="eyebrow text-terra-deep">
        {SETTLEMENT_STATE_LABEL[settlement.state]}
      </p>
      <h1 className="font-display tracking-display mt-3 text-3xl leading-tight">
        {weekLabel(settlement.periodStart, settlement.periodEnd)}
      </h1>

      <Panel className="mt-6">
        <p
          className={cn(
            "font-display tracking-display text-4xl leading-none",
            isOwedBack(settlement.netPaise) && "text-terra-deep",
          )}
        >
          {formatPaise(settlement.netPaise)}
        </p>

        <dl className="mt-5 space-y-2 text-sm">
          <Row label="Fares" value={formatPaise(settlement.grossPaise)} />
          <Row
            label="Our commission"
            value={formatPaise(settlement.commissionPaise)}
          />
          <Row label="Refunded" value={formatPaise(settlement.refundsPaise)} />
          <Row label="Bookings" value={String(settlement.bookings)} plain />
        </dl>

        {/*
          ONCE, at the top, before the rows. It is on the settlement and on no
          line, so an operator adding the rows up finds a different number by
          exactly this amount. Said here it explains the gap; said nowhere it
          becomes the reason somebody messages us.
        */}
        {showsAdjustments(settlement.adjustmentsPaise) ? (
          <div className="border-paper-line mt-5 border-t pt-4">
            <dl className="space-y-2 text-sm">
              <Row
                label="Correction"
                value={formatPaise(settlement.adjustmentsPaise)}
              />
            </dl>
            <p className="text-forest/70 mt-2 text-sm">
              A correction carried into this payout. It has no row of its own,
              so the bookings below add up to{" "}
              {formatPaise(settlement.netPaise - settlement.adjustmentsPaise)}.
            </p>
          </div>
        ) : null}

        {/*
          The bank's reference, and only once the transfer has been told to the
          bank. Absent before that, by the contract, and a blank labelled row
          would read as a missing reference rather than a payout that has not
          been sent.
        */}
        {settlement.state === "settled" && settlement.reference ? (
          <div className="border-paper-line mt-5 border-t pt-4">
            <dl className="space-y-2 text-sm">
              <Row label="Bank reference" value={settlement.reference} plain />
            </dl>
          </div>
        ) : null}
      </Panel>

      {hasStatement(settlement) ? (
        <DownloadStatement id={settlement.id} />
      ) : null}

      <section className="mt-10">
        <h2 className="font-display tracking-display text-2xl leading-tight">
          What it paid
        </h2>

        {lines.length === 0 ? (
          <div className="mt-4">
            <Empty
              title="No bookings on this payout"
              body="A week with no bookings to pay is not usually locked, so this is worth telling us about."
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {lines.map((line) => (
              <li key={line.bookingId}>
                <Panel tone="outline">
                  <div className="flex items-baseline justify-between gap-4">
                    <p className="font-mono text-sm tracking-wider">
                      {line.reference}
                    </p>
                    <p
                      className={cn(
                        "shrink-0 font-bold tabular-nums",
                        isOwedBack(line.netPaise) && "text-terra-deep",
                      )}
                    >
                      {formatPaise(line.netPaise)}
                    </p>
                  </div>
                  <p className="text-forest/70 mt-1 text-sm">
                    {dayWithWeekday(line.tripDate)} ·{" "}
                    {line.guests === 1 ? "1 person" : `${line.guests} people`}
                  </p>
                  <dl className="mt-3 space-y-1.5 text-sm">
                    <Row label="Fare" value={formatPaise(line.grossPaise)} />
                    <Row
                      label="Our commission"
                      value={formatPaise(line.commissionPaise)}
                    />
                    {/*
                      Shown only when there was one. A cancelled booking you kept
                      money on is a row with a commission of 0.00 and a refund,
                      and every other row would otherwise carry "Refunded ₹0".
                    */}
                    {line.refundedPaise !== 0 ? (
                      <Row
                        label="Refunded"
                        value={formatPaise(line.refundedPaise)}
                      />
                    ) : null}
                  </dl>
                </Panel>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

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
