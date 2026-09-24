import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { helpHref } from "@/lib/help";
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
import { CancelBooking } from "@/app/bookings/cancel-booking";
import { CashBack } from "@/app/bookings/cash-back";
import {
  answerFor,
  canCancelBooking,
  canReturnCash,
  endingLine,
  needsReview,
} from "@/lib/bookings/ending";
import { now } from "@/lib/format/market-time";
import { getBookingThread } from "@/lib/messages/fetch";
import { Conversation } from "./conversation";

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
 *
 * ## The trip and its time first, then who (yuvoy-operator#81 s5)
 *
 * An operator looks for 09:00 first, not for a person they have never met, so
 * the time and the trip are the title and the traveller's name sits under it.
 * One title and no stage caption (#80 t2), and no paragraph explaining the
 * screen (#80 t4): what those said is in help, and the one that is not
 * obvious (why there is no phone number) is linked from the foot.
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
  const at = await now();
  const ended = endingLine(booking.cancellation, booking.timezone);
  const questions = booking.questions ?? [];
  const time = booking.startsAt
    ? marketTime(booking.startsAt, booking.timezone)
    : null;
  const day = booking.startsAt
    ? marketDay(booking.startsAt, booking.timezone)
    : null;
  const trip = booking.experience || "Booking";
  const who = booking.name || booking.reference;

  /*
    The conversation, fetched here rather than in the client so the first page is
    in the server-rendered HTML. An operator opening a booking to find out what
    was agreed should not watch a spinner on the one part of the screen they came
    for.

    Soft-failing, and it is the only read on this page that does: the booking
    itself is the screen, and a conversation that could not load must not take
    the departure time and the guest count down with it. `null` is "we could not
    load it", which is a different sentence from "nothing has been said".
  */
  let thread = null;
  try {
    thread = await getBookingThread(token, id);
  } catch {
    thread = null;
  }

  return (
    <Screen nav={{ back: { href: "/bookings", label: "bookings" } }}>
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        {time ? (
          <>
            <span className="tabular-nums">{time}</span>{" "}
            <span className="text-3xl">{trip}</span>
          </>
        ) : (
          trip
        )}
      </h1>
      {day ? <p className="text-forest/80 mt-2 text-base">{day}</p> : null}

      <div className="mt-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xl font-bold wrap-break-word">{who}</p>
          <p className="text-forest/70 mt-1 text-sm">
            {booking.guests === 1 ? "1 guest" : `${booking.guests} guests`}
            {/*
              The reference, which is what the traveller reads out at the jetty
              and what support asks for. Under the name rather than instead of
              it, and only once: a booking with no name already leads with it.
            */}
            {booking.name && booking.reference ? (
              <>
                {" · "}
                <span className="font-mono tracking-wider">
                  {booking.reference}
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {state ? (
            <Chip tone={state.live ? "accent" : "neutral"}>{state.label}</Chip>
          ) : null}
          {/*
            The server's flag, and nothing else from screening ever. It means
            somebody has to be checked before the trip; it does NOT mean anything
            about what they disclosed, and it is not derivable from the answers
            below — the manifest carries a party the API flagged with `clear:
            true` beside it (O12, D-018).
          */}
          {needsReview(booking.screening) ? (
            <Chip tone="accent">Needs review</Chip>
          ) : null}
        </div>
      </div>

      {/*
        Why it ended, straight under which trip and whose it was, and above
        everything else about it. An operator opening a cancelled booking is
        asking one question, and the money and the answers below are the
        answers to different ones.
      */}
      {ended ? (
        <Panel tone="alert" className="mt-6 p-4">
          <p className="text-sm font-bold">{ended}</p>
        </Panel>
      ) : null}

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
        <section className="mt-8" aria-labelledby="cash-heading">
          <Panel>
            <h2 id="cash-heading" className="label text-forest/75">
              Cash at the counter
            </h2>
            {/*
              The screen's one primary action while the fare is still owed
              (#81 s5): "Take ₹10,000", and a quieter link for any other
              amount. How a cash booking pays out is in help, not here.
            */}
            <CashCollect
              bookingId={booking.id}
              slotId=""
              state={booking.state}
              cash={booking.cash}
              timezone={booking.timezone}
              emphasis="primary"
            />

            {/*
              Cancelled, and the notes are still in the till. We refunded
              nothing because nothing reached us, so the only thing that closes
              this out is the business handing it over and saying so.
            */}
            {/*
              `me.canManage`, exactly as with cancelling: `POST
              /bookings/{id}/cash-returned` answers 403 to STAFF. Left off at
              first, and an e2e caught it — a staff login was being offered a
              one-way write it could never make.
            */}
            {me.canManage && canReturnCash(booking.state, booking.cash) ? (
              <CashBack
                bookingId={booking.id || id}
                amountPaise={
                  booking.cash.collectedPaise ?? booking.cash.collectPaise
                }
              />
            ) : null}
            {booking.cash.returnedAt &&
            booking.cash.returnedPaise !== undefined ? (
              <p className="text-forest/80 mt-3 text-sm">
                Given back {formatPaise(booking.cash.returnedPaise)} on{" "}
                {marketDay(booking.cash.returnedAt, booking.timezone)}.
              </p>
            ) : null}
          </Panel>
        </section>
      ) : booking.money ? (
        /*
          The money on THIS booking, for the "why is this two hundred rupees
          less than I expected" question. Frozen at capture, so a commission
          change today cannot restate what was earned last week.
        */
        <Panel className="mt-8 p-0">
          <dl className="divide-paper-line divide-y text-sm">
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
        </Panel>
      ) : (
        /*
          Absent means NO MONEY MOVED, not "unknown" — a request awaiting an
          answer has captured nothing — so the absence stays an absence rather
          than becoming a row of zeroes somebody tries to reconcile.
        */
        <p className="text-forest/70 mt-8 text-sm">
          No money has moved on this one yet.
        </p>
      )}

      {/*
        What the listing asked, and what this party said. In the order sent, and
        never a blank: a question with nothing under it reads as an answer.
      */}
      {questions.length > 0 ? (
        <section className="mt-8" aria-labelledby="answers">
          <h2 id="answers" className="label text-forest/75">
            What they answered
          </h2>
          <Panel className="mt-3 p-0">
            <dl className="divide-paper-line divide-y text-sm">
              {questions.map((question) => (
                <div key={question.questionId} className="px-5 py-4">
                  <dt className="text-forest/75">
                    {question.text}
                    {/*
                      "Only an answered question appears with `current: false`",
                      and it is kept "so an answer to a reworded question stays
                      readable with the words it answered". Marked, because an
                      operator comparing two parties needs to know why one of
                      them was asked something the listing no longer asks.
                    */}
                    {!question.current ? (
                      <span className="text-forest/70"> · no longer asked</span>
                    ) : null}
                  </dt>
                  <dd className="mt-1 font-bold">{answerFor(question)}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </section>
      ) : null}

      {/*
        Cancelling one booking. Withheld rather than offered and refused: the
        API takes it only on a booking that is still on, on a departure that has
        not left, and both are knowable from what is already on this screen.
        `me.canManage` is the role gate (STAFF never sees it), and it stays
        drawn while the business is suspended (#50).

        Quiet text, behind a confirm that names what happens (#81), and below
        everything that is not destructive.
      */}
      {/*
        Mounted for every manager whether or not the booking can still be
        cancelled, drawing nothing when it cannot. That is what lets the
        receipt of a cancel stay on screen while the page underneath re-reads
        to the cancelled booking (op#89 f16).
      */}
      {me.canManage ? (
        <CancelBooking
          bookingId={booking.id || id}
          reference={booking.reference}
          isCash={Boolean(booking.cash)}
          available={canCancelBooking(booking.state, booking.startsAt, at)}
          className="mt-8"
        />
      ) : null}

      {thread ? (
        <Conversation bookingId={booking.id || id} initial={thread} />
      ) : (
        <section
          className="mt-10"
          aria-labelledby="conversation-heading"
          id="conversation"
        >
          <h2
            id="conversation-heading"
            className="font-display tracking-display text-2xl leading-tight"
          >
            Conversation
          </h2>
          {/*
            "Did not load", never "nothing was said". The second is a claim about
            this booking, and an operator who acts on it walks to a jetty without
            the thing the traveller asked for.
          */}
          <p className="text-forest/70 mt-2 text-sm">
            The conversation did not load. Reload the page to try again.
          </p>
        </section>
      )}

      {/*
        Why there is no number, one tap away rather than a paragraph at the
        foot of every booking (#80 t4). It is the one question this screen
        raises that nothing on it answers, so it earns a link.
      */}
      <div className="border-paper-line mt-10 border-t pt-4">
        <Link
          href={helpHref("traveller-phone-numbers", `/bookings/${id}`)}
          className="text-forest/80 decoration-forest/40 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
        >
          Why there is no phone number
        </Link>
      </div>
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
