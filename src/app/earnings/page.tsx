import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import {
  getChangeRequests,
  getEarnings,
  listBookings,
} from "@/lib/money/fetch";
import {
  canStillMove,
  describeState,
  monthRange,
  payoutHold,
  reconciles,
} from "@/lib/money/earnings";
import {
  bookingReconciles,
  describeCash,
  type BookingLine,
} from "@/lib/money/bookings";
import { describeBookingState } from "@/lib/day/booking-state";
import { formatPaise } from "@/lib/format/money";
import { marketDay, marketTime, now } from "@/lib/format/market-time";
import { Empty, Problem } from "@/components/ui/states";
import { Screen } from "@/components/chrome/screen";
import { Panel, panelClass } from "@/components/ui/panel";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Earnings" };

/*
  Never prerendered, never cached. A figure that can still move must not be
  served from a cache that cannot.
*/
export const dynamic = "force-dynamic";

const BACK = { href: "/account", label: "your business" };

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

  /*
    Refused before the request, not after it.

    `GET /earnings` is "Requires OWNER or MANAGER" and answers 403 to a staff
    login, and this page used to make the call anyway. The throw landed on the
    error boundary, which says "That did not load — try again" — false, and
    unactionable: retrying will never work, because nothing went wrong.

    The contract's own reasoning is the copy: "a staff member who can see
    today's manifest does not need the margin on it." Same call as the queue in
    O9 and the seats in capacity — say it first rather than let somebody meet a
    refusal they cannot read.
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
            title="Earnings are for an owner or a manager"
            body="A staff login runs the day (today's manifest, who has arrived) and does not carry what the business is owed. Ask an owner or a manager if you need the figure."
          />
        </div>
      </Screen>
    );
  }

  // 0 = this month, 1 = last. Validated rather than trusted: it arrives in a URL.
  const monthsAgo = month === "last" ? 1 : 0;
  const { from, to } = monthRange(monthsAgo, await now());

  const [earnings, changes, bookings] = await Promise.all([
    getEarnings(token, from, to),
    getChangeRequests(token),
    listBookings(token, from, to),
  ]);

  const hold = payoutHold(changes);
  const moving = canStillMove(earnings.state);
  const addsUp = reconciles(earnings);

  return (
    <Screen nav={{ back: BACK }} stageLabel="Earnings">
      <p className="eyebrow text-terra-deep">{me.name || "Your account"}</p>
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
            body={`${hold.summary ?? "A bank change"} is ${hold.state === "cooling" ? "approved and waiting out its cooling period" : hold.state === "objection_window" ? "in its objection window: you can still stop it" : "awaiting review"}. Nothing is paid out until it settles. If you did not request this, stop it now from Payout details.`}
          />
        </div>
      ) : null}

      {/*
        The arithmetic, not a headline. An operator reconciling against their
        own book needs to see WHICH line disagrees.
      */}
      <section className="mt-8" aria-labelledby="totals">
        <h2 id="totals" className="label text-forest/75">
          {monthsAgo === 0 ? "This month" : "Last month"}
        </h2>
        <Panel className="mt-3 p-0">
          <dl className="divide-cream-line divide-y">
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
        </Panel>
      </section>

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
            body="Gross minus commission minus refunds does not equal the net shown. Do not reconcile against this. Send us the dates and we will find it."
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
        Every figure is frozen at the moment money is captured, so a commission
        change today cannot restate what you earned last week.
        {earnings.from && earnings.to
          ? ` Covering ${earnings.from} to ${earnings.to}.`
          : null}
      </p>

      {/*
        Each booking's own arithmetic — the answer to "why is THIS one ₹200
        less", which is a per-booking question and the reason this list exists
        (yuvoy-api#60).

        Deliberately not summed. `/earnings` selects on when the money moved;
        this list on when the trip runs, so a screenful of these does not
        reproduce the total above unless both windows happened to agree. The
        caption says so rather than letting an operator discover it with a
        calculator.
      */}
      <section className="mt-10" aria-labelledby="by-booking">
        <h2 id="by-booking" className="label text-forest/75">
          By booking
        </h2>
        <p className="text-forest/70 mt-2 text-sm">
          Every departure in this window, with what it contributed. These do not
          add up to the total above, on purpose: the total counts when money
          moved, this list counts when the trip runs. Reconcile one booking
          against itself, not this page against the month.
        </p>

        {bookings === null ? (
          <div className="mt-4">
            <Problem
              title="The bookings did not load"
              body="The totals above are unaffected. Try again in a moment. Nothing here has changed because of it."
            />
          </div>
        ) : bookings.length === 0 ? (
          <div className="mt-4">
            <Empty
              title="No departures in this window"
              body="Bookings appear here by the day the trip runs. A booking made this month for a trip next month is in next month's list."
            />
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {bookings.map((b) => (
              <li key={b.id} className={panelClass("raised", "p-0")}>
                <div className="flex items-baseline justify-between gap-3 px-5 pt-4">
                  <p className="text-base font-bold">{b.name || b.reference}</p>
                  <p className="text-forest/70 text-sm">
                    {b.guests} {b.guests === 1 ? "guest" : "guests"}
                  </p>
                </div>
                {b.reference ? (
                  <p className="text-forest/70 px-5 font-mono text-sm tracking-wider">
                    {b.reference}
                  </p>
                ) : null}
                <p className="text-forest/70 mt-1 px-5 text-sm">
                  {b.experience}
                  {b.startsAt
                    ? ` · ${marketDay(b.startsAt, b.timezone)}, ${marketTime(b.startsAt, b.timezone)}`
                    : null}
                </p>

                {b.money ? (
                  <>
                    <dl className="divide-cream-line border-cream-line mt-3 divide-y border-t">
                      <Line
                        label="Gross"
                        value={formatPaise(b.money.grossPaise)}
                        compact
                      />
                      <Line
                        label="Yuvoy's commission"
                        value={`− ${formatPaise(b.money.commissionPaise)}`}
                        compact
                      />
                      <Line
                        label="Refunds"
                        value={`− ${formatPaise(b.money.refundsPaise)}`}
                        compact
                      />
                      <Line
                        label="Net"
                        value={formatPaise(b.money.netPaise)}
                        emphasis
                        compact
                      />
                    </dl>
                    {/*
                      The per-row twin of the totals' check. `netPaise` is
                      sent, not derived, so a row that disagrees with its own
                      parts is told not to be reconciled against rather than
                      quietly recomputed.
                    */}
                    {!bookingReconciles(b.money) ? (
                      <p
                        role="alert"
                        className="text-terra-deep px-5 pb-4 text-sm font-bold"
                      >
                        These figures do not add up. Do not reconcile against
                        this booking. Send us the reference and we will find it.
                      </p>
                    ) : null}
                  </>
                ) : b.cash ? (
                  /*
                    Paid at the counter — yuvoy-operator#40. None of it passed
                    through Yuvoy, so it is in none of the figures above, and
                    the share owed on it lives on `/cash`. The API's `money` on
                    such a booking is gross ₹0 and a negative net, which
                    `toBookingLine` drops rather than let this list render.
                  */
                  <p className="text-forest/70 border-cream-line mt-3 border-t px-5 py-4 text-sm">
                    Cash at the counter, so it is not in these figures.{" "}
                    <span className="font-bold">
                      {describeCash(b.cash, b.timezone)}
                    </span>
                  </p>
                ) : (
                  /*
                    "Absent, not zeroed." A booking that has captured nothing
                    has nothing to reconcile, and a row of ₹0s would invite
                    exactly that.

                    The state in the operator's words. This printed the raw
                    column value — `pending_request` — which is the defect
                    yuvoy-operator#34 fixed on Bookings and this list kept.
                  */
                  <p className="text-forest/70 border-cream-line mt-3 border-t px-5 py-4 text-sm">
                    No money has moved for this booking yet.
                    {stateWord(b) ? (
                      <span className="font-bold"> · {stateWord(b)}</span>
                    ) : null}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}

/** A booking's state in the operator's words, or nothing for one we cannot name. */
function stateWord(b: BookingLine): string | null {
  return describeBookingState(b.state, b.cash)?.label ?? null;
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
      className={cn(
        "dock-target ease-interaction rounded-full border px-6 text-sm transition-colors duration-200",
        active
          ? "border-forest bg-forest text-cream font-bold"
          : "border-cream-line bg-cream-deep hover:border-forest/40",
      )}
    >
      {label}
    </Link>
  );
}

function Line({
  label,
  value,
  emphasis,
  compact,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  /** A row inside a booking, not the month's total: tighter, and no display figure. */
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 px-5",
        compact ? "py-3" : "py-4",
      )}
    >
      <dt
        className={emphasis ? "text-base font-bold" : "text-forest/80 text-sm"}
      >
        {label}
      </dt>
      <dd
        className={
          emphasis
            ? compact
              ? "text-base font-bold"
              : "font-display text-3xl leading-none"
            : "text-forest/80 font-mono text-sm"
        }
      >
        {value}
      </dd>
    </div>
  );
}
