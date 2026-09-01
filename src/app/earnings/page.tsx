import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { getChangeRequests, getEarnings } from "@/lib/money/fetch";
import {
  canStillMove,
  describeState,
  monthRange,
  payoutHold,
  reconciles,
} from "@/lib/money/earnings";
import { formatPaise } from "@/lib/format/money";
import { now } from "@/lib/format/market-time";
import { Problem } from "@/components/ui/states";

export const metadata: Metadata = { title: "Earnings" };

/*
  Never prerendered, never cached. A figure that can still move must not be
  served from a cache that cannot.
*/
export const dynamic = "force-dynamic";

/**
 * O11 — what the operator is owed, and why it is that number.
 *
 * The "why" matters as much as the total: an operator asking "why is this
 * ₹200 less than I expected" should be able to answer it here rather than by
 * messaging us. So the arithmetic is shown as arithmetic — gross, minus
 * commission, minus refunds, equals net — rather than a headline with the
 * workings hidden.
 *
 * Read-only. There is no action on this screen and there should not be.
 */
export default async function EarningsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { token, me } = await requireOperator();
  const { month } = await searchParams;

  // 0 = this month, 1 = last. Validated rather than trusted: it arrives in a URL.
  const monthsAgo = month === "last" ? 1 : 0;
  const { from, to } = monthRange(monthsAgo, await now());

  const [earnings, changes] = await Promise.all([
    getEarnings(token, from, to),
    getChangeRequests(token),
  ]);

  const hold = payoutHold(changes);
  const moving = canStillMove(earnings.state);
  const addsUp = reconciles(earnings);

  return (
    <main className="bg-cream text-forest min-h-dvh">
      <div className="container-page max-w-2xl py-8">
        <Link
          href="/today"
          className="label text-forest/70 hover:text-forest tap-target underline underline-offset-4"
        >
          ← The day
        </Link>

        <p className="eyebrow text-terra-deep mt-6">
          {me.name || "Your account"}
        </p>
        <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
          Earnings
        </h1>

        <nav className="mt-6 flex gap-2" aria-label="Which month">
          <MonthLink
            label="This month"
            href="/earnings"
            active={monthsAgo === 0}
          />
          <MonthLink
            label="Last month"
            href="/earnings?month=last"
            active={monthsAgo === 1}
          />
        </nav>

        {/*
          A payout held by a bank change in flight. Above the number, because
          it changes what the number means: it is owed, and it is not moving.
        */}
        {hold ? (
          <div className="mt-6">
            <Problem
              title="Payouts are on hold while your bank change is reviewed"
              body={`${hold.summary ?? "A bank change"} is ${hold.state === "cooling" ? "approved and waiting out its cooling period" : hold.state === "objection_window" ? "in its objection window — you can still stop it" : "awaiting review"}. Nothing is paid out until it settles. If you did not request this, stop it now from Payout details.`}
            />
          </div>
        ) : null}

        {/*
          The arithmetic, not a headline. An operator reconciling against their
          own book needs to see WHICH line disagrees.
        */}
        <dl className="border-cream-line mt-8 border-t">
          <Line label="Bookings" value={String(earnings.bookings)} />
          <Line label="Gross" value={formatPaise(earnings.grossPaise)} />
          <Line
            label="Yuvoy's commission"
            value={`− ${formatPaise(earnings.commissionPaise)}`}
          />
          <Line
            label="Refunds"
            value={`− ${formatPaise(earnings.refundsPaise)}`}
          />
          <Line label="Net" value={formatPaise(earnings.netPaise)} emphasis />
        </dl>

        {/*
          If the parts do not sum to the total, say so rather than rendering a
          number that quietly disagrees with itself. This has never fired; it
          exists because a reconciliation screen that cannot reconcile is worse
          than no screen.
        */}
        {!addsUp ? (
          <div className="mt-6">
            <Problem
              title="These figures do not add up"
              body="Gross minus commission minus refunds does not equal the net shown. Do not reconcile against this — send us the dates and we will find it."
            />
          </div>
        ) : null}

        <p
          className={
            moving
              ? "text-terra-deep mt-6 text-sm font-bold"
              : "text-forest/80 mt-6 text-sm"
          }
        >
          {describeState(earnings.state)}
        </p>

        <p className="text-forest/70 mt-6 text-sm">
          Every figure is frozen at the moment money is captured, so a
          commission change today cannot restate what you earned last week.
          {earnings.from && earnings.to
            ? ` Covering ${earnings.from} to ${earnings.to}.`
            : null}
        </p>

        {/*
          Stated rather than hidden. The API returns totals only, so a
          per-booking "why is this one ₹200 less" cannot be answered here yet.
          Raised on yuvoy-api rather than worked around — see the issue.
        */}
        <p className="text-forest/70 border-cream-line mt-8 border-t pt-6 text-sm">
          Need the per-booking breakdown? It is not here yet — the totals are
          all we are given today. Ask us and we will send it while we get it
          onto this screen.
        </p>
      </div>
    </main>
  );
}

function MonthLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-edge border-forest bg-forest text-cream dock-target border px-5 text-sm font-bold"
          : "rounded-edge border-cream-line bg-cream-deep dock-target border px-5 text-sm"
      }
    >
      {label}
    </Link>
  );
}

function Line({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="border-cream-line flex items-baseline justify-between gap-4 border-b py-4">
      <dt
        className={emphasis ? "text-base font-bold" : "text-forest/80 text-sm"}
      >
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? "font-display text-3xl leading-none"
            : "text-forest/80 font-mono text-sm"
        }
      >
        {value}
      </dd>
    </div>
  );
}
