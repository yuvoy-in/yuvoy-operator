import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { toBookingLine } from "@/lib/money/bookings";
import { describeBookingState } from "@/lib/day/booking-state";
import { marketDay, marketTime } from "@/lib/format/market-time";
import { formatPaise } from "@/lib/format/money";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { Screen } from "@/components/chrome/screen";
import { CashCollect } from "@/app/bookings/cash-collect";

export const metadata: Metadata = { title: "Booking" };
export const dynamic = "force-dynamic";

/**
 * One booking — yuvoy-operator#34.
 *
 * `GET /operator/v1/bookings/{id}`, which existed and was called by nothing.
 * A focused screen rather than a tab root: an operator goes INTO a booking
 * from the list and comes back out of it.
 *
 * ## What is deliberately not here
 *
 * **A phone number.** `contact` carries the name and only the name — the
 * `whatsapp` field was removed in M13 per D-018, and the reasoning is worth
 * repeating so nobody adds a column back: "a traveller gives us a number so we
 * can tell them about their booking, not so it can be added to an operator's
 * contacts." To reach this traveller an operator uses the relay, which sends
 * an approved template and leaves a record of who said what. To identify them
 * at the jetty they use the reference, which the traveller already has in
 * every message we send.
 *
 * **A medical answer.** The manifest's screening flag is `needsAttention`,
 * which means somebody has not answered the health question — not what they
 * answered. That flag lives on the manifest, per departure, and it stays
 * there; a booking detail page is not a second place to leak a health answer
 * from. The product demo shows one here; the owner ruled on 11 Sep 2026 that
 * this rule stands (yuvoy-operator#43).
 */
export default async function BookingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { token, me } = await requireOperator();

  let booking;
  try {
    const { data, error } = await operatorApi(token).GET("/bookings/{id}", {
      params: { path: { id } },
    });
    if (error) throw error;
    booking = toBookingLine(data);
  } catch (err) {
    /*
      404 covers "no such booking" and "another operator's" identically, and
      the API says so: "a 403 confirms the booking exists, which is exactly
      what somebody probing ids wants to learn." One answer, and this screen
      does not speculate about which it got either.
    */
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  const state = describeBookingState(booking.state, booking.cash);

  return (
    <Screen
      nav={{ back: { href: "/bookings", label: "bookings" } }}
      stageLabel="Booking"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h1 className="font-display tracking-display text-4xl leading-[1.05]">
          {booking.name || booking.reference}
        </h1>
        {state ? (
          <Chip tone={state.live ? "accent" : "neutral"}>{state.label}</Chip>
        ) : null}
      </div>

      {booking.reference ? (
        <p className="text-forest/70 mt-3 font-mono text-lg tracking-wider">
          {booking.reference}
        </p>
      ) : null}

      <Panel className="mt-8 p-0">
        <dl className="divide-cream-line divide-y text-sm">
          <Row label="Experience">{booking.experience}</Row>
          {booking.startsAt ? (
            <Row label="Departs">
              {marketDay(booking.startsAt, booking.timezone)},{" "}
              {marketTime(booking.startsAt, booking.timezone)}
            </Row>
          ) : null}
          <Row label="Guests">{booking.guests}</Row>
        </dl>
      </Panel>

      {booking.cash ? (
        /*
          PAID AT THE COUNTER — yuvoy-operator#40 §1.

          Not the card arithmetic below, and not a softened version of it. The
          API sends `money` on a cash booking as gross ₹0 and a negative net —
          nothing was captured and the share on the fare is stored — and read
          as arithmetic that says the operator lost money on a trip they were
          paid for in full. `toBookingLine` drops it; this says what is true
          instead, and puts the collection where the operator can record it.
        */
        <section className="mt-6" aria-labelledby="cash-heading">
          <Panel>
            <h2 id="cash-heading" className="label text-forest/75">
              Cash at the counter
            </h2>
            <p className="text-forest/80 mt-2 text-sm">
              They hand you the fare on the day. None of it passes through
              Yuvoy, so there is no payout on this booking.
            </p>
            {/*
              `/cash` is OWNER or MANAGER, like earnings, so a staff login is
              not sent to a screen that turns it away.
            */}
            {me.canManage ? (
              <p className="text-forest/80 mt-2 text-sm">
                Yuvoy&rsquo;s share of it shows on{" "}
                <Link href="/cash" className="underline underline-offset-2">
                  Cash you&rsquo;ve collected
                </Link>{" "}
                once the trip is done.
              </p>
            ) : null}
            <CashCollect
              bookingId={booking.id}
              slotId=""
              state={booking.state}
              cash={booking.cash}
              timezone={booking.timezone}
            />
          </Panel>
        </section>
      ) : booking.money ? (
        /*
          The money on THIS booking, for the "why is this two hundred rupees
          less than I expected" question. Frozen at capture, so a commission
          change today cannot restate what was earned last week.
        */
        <Panel className="mt-6 p-0">
          <dl className="divide-cream-line divide-y text-sm">
            <Row label="Gross">{formatPaise(booking.money.grossPaise)}</Row>
            <Row label="Yuvoy's commission">
              − {formatPaise(booking.money.commissionPaise)}
            </Row>
            <Row label="Refunds">
              − {formatPaise(booking.money.refundsPaise)}
            </Row>
            <Row label="Net">
              <strong>{formatPaise(booking.money.netPaise)}</strong>
            </Row>
          </dl>
          <p className="text-forest/70 border-cream-line border-t px-5 py-4 text-xs">
            These are the frozen figures Earnings sums, for this booking alone.
            Earnings counts by when the money moved and this list by when the
            trip runs, so a screenful of these will not add up to a month.
          </p>
        </Panel>
      ) : (
        /*
          Absent means NO MONEY MOVED, not "unknown" — a request awaiting an
          answer has captured nothing — so the absence stays an absence rather
          than becoming a row of zeroes somebody tries to reconcile.
        */
        <p className="text-forest/70 mt-6 text-sm">
          No money has moved on this one yet.
        </p>
      )}

      <p className="text-forest/70 border-cream-line mt-10 border-t pt-6 text-xs">
        We do not show traveller phone numbers. Read the reference back to them
        at the jetty — they have it in every message we send — and to tell
        everybody on a departure something, use the message box on that day
        under Today.
      </p>
    </Screen>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 px-5 py-4">
      <dt className="label text-forest/75">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
