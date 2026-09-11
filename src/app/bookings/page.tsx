import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import { urgencyOf } from "@/lib/day/request-types";
import { listBookings } from "@/lib/money/fetch";
import { describeCash } from "@/lib/money/bookings";
import {
  describeBookingState,
  isUpcomingBooking,
} from "@/lib/day/booking-state";
import { marketDay, marketDays, marketTime } from "@/lib/format/market-time";
import { Empty, Problem } from "@/components/ui/states";
import { Chip } from "@/components/ui/chip";
import { panelClass } from "@/components/ui/panel";
import { RequestQueue } from "./request-queue";
import { RefreshOnFocus } from "@/components/chrome/refresh-on-focus";
import { Screen } from "@/components/chrome/screen";

export const metadata: Metadata = { title: "Bookings" };

/*
  Never prerendered, never cached, and re-read after every answer. Every
  request here has a clock on it and a traveller behind it.
*/
export const dynamic = "force-dynamic";

/** How far either side of today this screen lists. */
const BACK_DAYS = 30;
const AHEAD_DAYS = 90;

/**
 * Who has booked — yuvoy-operator#34.
 *
 * ## Why this tab replaced Requests
 *
 * There was no list of "who has booked me" anywhere in the portal. There was a
 * Requests tab, which holds ONLY request-mode bookings awaiting an answer, a
 * manifest per departure reached by opening a day, and money lines inside
 * Earnings. `GET /bookings` and `GET /bookings/{id}` both existed and were
 * called by nothing.
 *
 * Migration 0054 then changed the default booking mode from `request` to
 * `allotment` (D-031 P5), because the product thesis is paid and confirmed
 * inside sixty seconds. So an operator on the new default has an EMPTY
 * Requests tab and no bookings screen at all, and their only view of a
 * confirmed booking is to open the right day and read the manifest — which
 * means knowing the date first. "Has my booking come through" is the common
 * phone call, and they could not answer it without guessing.
 *
 * Requests are still first on the page and still ordered by how soon each
 * expires. They are the only thing here with a deadline, and a queue whose job
 * is to stop requests dying must not be re-sorted for tidiness.
 *
 * ## What an operator may and may not see
 *
 * **No phone number, ever.** `contact` carries the name and only the name —
 * `whatsapp` was removed in M13 per D-018: "a traveller gives us a number so
 * we can tell them about their booking, not so it can be added to an
 * operator's contacts." The reference is how a person walking up a jetty is
 * matched to a row, and the relay is how they are reached. No contact column
 * is added here because the endpoint returns something that looks like one.
 */
export default async function BookingsPage() {
  const { token, me } = await requireOperator();
  const { today } = await marketDays();

  const from = shift(today, -BACK_DAYS);
  const to = shift(today, AHEAD_DAYS);

  /*
    Two sources, one screen, and neither may take the other down.

    Requests come from `/requests` and are the queue with a deadline; bookings
    come from `/bookings` and are the record. `listBookings` already degrades
    to `null` on failure for Earnings, and that distinction is kept: `null` is
    "we could not load it" and `[]` is "nothing in this window", which are
    different sentences and only one of them is a reason to worry.
  */
  const [requests, bookings] = await Promise.all([
    listOpenRequests(token).catch(() => null),
    listBookings(token, from, to),
  ]);

  const critical = (requests ?? []).filter(
    (r) => urgencyOf(r.minutesToAnswer) === "critical",
  ).length;

  /*
    An unanswered request is in BOTH responses, and must appear once.

    `GET /bookings` includes `pending_request` rows — the contract says so
    itself when it explains why such a row carries no `money` — and
    `GET /requests` returns the same open requests. Rendering both lists whole
    would put one traveller on one screen twice, in two visual languages, with
    only one of the two carrying the clock and the buttons that matter.

    The queue wins, because it is the copy that can be acted on. Filtered
    here rather than in the fetch so the "nothing in this window" branch below
    still counts a request as something rather than saying the window is
    empty while a request sits above it.
  */
  const settled = (bookings ?? []).filter(
    (b) => b.state?.trim().toLowerCase() !== "pending_request",
  );
  const upcoming = settled.filter((b) => isUpcomingBooking(b.state));
  const past = settled.filter((b) => !isUpcomingBooking(b.state));

  return (
    <Screen>
      <RefreshOnFocus />

      <p className="eyebrow text-terra-deep">Who is coming</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Bookings
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Everyone who has booked you, and anyone still waiting on your answer.
      </p>

      {/*
        STAFF can see this and cannot answer a request. Said up front rather
        than after somebody chooses a reason, taps Decline and reads a 403 —
        the contract refuses the write, not the read.
      */}
      {!me.canManage ? (
        <div className="mt-6">
          <Problem
            title="You can see these, but not answer them"
            body="Granting seats needs an owner or a manager. Pass it on rather than letting the clock run out."
          />
        </div>
      ) : null}

      <section className="mt-10" aria-labelledby="waiting-heading">
        <h2 id="waiting-heading" className="font-display text-3xl">
          Waiting on you
        </h2>
        <p className="text-forest/70 mt-2 text-sm">
          Nobody holds a seat until you say yes. Soonest to expire first.
        </p>

        {critical > 0 ? (
          <p className="text-terra-deep mt-4 text-sm font-bold">
            {critical} {critical === 1 ? "request runs" : "requests run"} out
            within the hour.
          </p>
        ) : null}

        <div className="mt-5">
          {requests === null ? (
            <Problem
              title="The requests did not load"
              body="Your bookings below are unaffected. Try again in a moment."
            />
          ) : (
            /*
              The list and its receipts are one client component on purpose:
              the receipt an accept produces has to outlive the row the next
              refresh removes. See `RequestQueue`.
            */
            <RequestQueue requests={requests} canAnswer={me.canManage} />
          )}
        </div>
      </section>

      <section className="mt-14" aria-labelledby="booked-heading">
        <h2 id="booked-heading" className="font-display text-3xl">
          Booked
        </h2>
        <p className="text-forest/70 mt-2 text-sm">
          Listed by the day the trip runs — the last month and the next three.
        </p>

        {bookings === null ? (
          <div className="mt-5">
            <Problem
              title="The bookings did not load"
              body="This is us, not you. Try again in a moment — nothing has changed because of it."
            />
          </div>
        ) : settled.length === 0 ? (
          <div className="mt-5">
            <Empty
              title="Nothing booked in this window"
              body="Bookings appear here by the day the trip runs, so one made today for a trip in six months is not in this list yet."
            />
          </div>
        ) : (
          <>
            <BookingList
              heading="Still to come"
              bookings={upcoming}
              empty="Nothing ahead in the next three months."
            />
            <BookingList
              heading="Been and gone"
              bookings={past}
              empty="Nothing behind you in the last month."
            />
          </>
        )}
      </section>
    </Screen>
  );
}

function BookingList({
  heading,
  bookings,
  empty,
}: {
  heading: string;
  bookings: Awaited<ReturnType<typeof listBookings>> & object;
  empty: string;
}) {
  return (
    <div className="mt-8">
      <h3 className="label text-forest/75">{heading}</h3>
      {bookings.length === 0 ? (
        <p className="text-forest/70 mt-3 text-sm">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {bookings.map((b) => {
            /*
              With its cash — yuvoy-operator#40. A cash booking waiting on the
              operator reads "Collect ₹9,000", never the card sentence
              "Payment clearing" its state would otherwise produce.
            */
            const state = describeBookingState(b.state, b.cash);
            return (
              <li key={b.id}>
                <Link
                  href={`/bookings/${b.id}`}
                  className={panelClass(
                    "raised",
                    "hover:border-forest/40 ease-interaction block transition-colors duration-200",
                  )}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    {/*
                      The name if we have it, the reference if not. Never a
                      number: `contact` carries the name and only the name.
                    */}
                    <p className="text-base font-bold">
                      {b.name || b.reference}
                    </p>
                    {/*
                      Mapped, never raw. This list returns `fulfilment_state`
                      verbatim — a column value — so an unmapped one renders no
                      chip rather than shouting `paid_pending_ops` at somebody.
                    */}
                    {state ? (
                      <Chip tone={state.live ? "accent" : "neutral"}>
                        {state.label}
                      </Chip>
                    ) : null}
                  </div>
                  {b.reference ? (
                    <p className="text-forest/70 mt-1 font-mono text-sm tracking-wider">
                      {b.reference}
                    </p>
                  ) : null}
                  <p className="text-forest/70 mt-2 text-sm">
                    {b.experience}
                    {b.startsAt
                      ? ` · ${marketDay(b.startsAt, b.timezone)}, ${marketTime(b.startsAt, b.timezone)}`
                      : null}
                  </p>
                  <p className="text-forest/70 mt-1 text-sm">
                    {b.guests} {b.guests === 1 ? "guest" : "guests"}
                  </p>
                  {/*
                    Once taken, the row says so and when. While it is owed the
                    chip already carries the amount, and a second line saying
                    the same would bury the rest of the row.
                  */}
                  {b.cash?.collected ? (
                    <p className="text-forest/70 mt-1 text-sm">
                      {describeCash(b.cash, b.timezone)}
                    </p>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A date `days` either side of `day`, as `YYYY-MM-DD`. */
function shift(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}
