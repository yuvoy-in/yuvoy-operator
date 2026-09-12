import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import { urgencyOf } from "@/lib/day/request-types";
import {
  BOOKINGS_PAGE,
  apiWindow,
  inMarketDays,
  shiftDay,
} from "@/lib/day/calendar";
import {
  byMarketDay,
  mostRecentFirst,
  uniqueById,
} from "@/lib/day/booking-days";
import { listBookings } from "@/lib/money/fetch";
import { describeCash, type BookingLine } from "@/lib/money/bookings";
import {
  describeBookingState,
  isUpcomingBooking,
} from "@/lib/day/booking-state";
import {
  dayCaption,
  marketDay,
  marketDays,
  marketTime,
  now,
} from "@/lib/format/market-time";
import { Problem } from "@/components/ui/states";
import { Chip } from "@/components/ui/chip";
import { buttonClass } from "@/components/ui/button";
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
 * Who has booked — yuvoy-operator#34, and the demo's three views, #43.
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
 * ## Requests, Confirmed and Past — places on one screen, not three tabs
 *
 * The demo splits these into sub-tabs. Here they are three sections in that
 * order, with a row of links to each, and that is deliberate rather than an
 * omission: the queue is the only thing on the screen with a deadline, and a
 * tab that hides it behind "Confirmed" is a request left to expire. One screen
 * also keeps the promise #34 made — a booking is never on it twice, in two
 * visual languages — checkable in one place.
 *
 * - **Requests** stay first, ordered by how soon each expires; each says when
 *   the trip is and how long ago they asked.
 * - **Confirmed** is the promises still to keep, grouped by the day the trip
 *   runs with the day's bookings and guests added up.
 * - **Past** is everything that has run or will not, most recent first.
 *
 * ## What an operator may and may not see
 *
 * **No phone number, ever** — masked or not, and whatever the demo draws.
 * `contact` carries the name and only the name — `whatsapp` was removed in
 * M13 per D-018: "a traveller gives us a number so we can tell them about
 * their booking, not so it can be added to an operator's contacts." The
 * reference is how a person walking up a jetty is matched to a row, and the
 * relay is how they are reached.
 */
export default async function BookingsPage() {
  const { token, me } = await requireOperator();
  const { today, tomorrow } = await marketDays();
  const at = await now();

  const ahead = shiftDay(today, AHEAD_DAYS);
  const back = shiftDay(today, -BACK_DAYS);
  const yesterday = shiftDay(today, -1);

  /*
    Three reads, and none may take another down.

    Requests come from `/requests` and are the queue with a deadline. The
    bookings are read as TWO windows rather than one, because `GET /bookings`
    stops at 100 rows, oldest trip first, with no cursor: one read of four
    months lets a busy month of the past push next week's trips off the end of
    the list. Each window is asked a day wider than it means — the API's dates
    are UTC days, the screen's are the market's — and cut back to its days.

    `null` stays "we could not load it" and `[]` stays "nothing in this
    window": different sentences, and only one is a reason to worry.
  */
  const upcomingAsked = apiWindow(today, ahead);
  const pastAsked = apiWindow(back, yesterday);
  const [requests, upcomingRead, pastRead] = await Promise.all([
    listOpenRequests(token).catch(() => null),
    listBookings(token, upcomingAsked.from, upcomingAsked.to),
    listBookings(token, pastAsked.from, pastAsked.to),
  ]);

  const critical = (requests ?? []).filter(
    (r) => urgencyOf(r.minutesToAnswer) === "critical",
  ).length;

  /*
    An unanswered request is in BOTH responses, and must appear once.

    `GET /bookings` includes `pending_request` rows — the contract says so
    itself when it explains why such a row carries no `money` — and
    `GET /requests` returns the same open requests. The queue wins, because it
    is the copy that can be acted on.
  */
  const notARequest = (b: BookingLine) =>
    b.state?.trim().toLowerCase() !== "pending_request";

  const upcomingDays =
    upcomingRead === null
      ? null
      : inMarketDays(upcomingRead, today, ahead).filter(notARequest);
  const pastDays =
    pastRead === null
      ? null
      : inMarketDays(pastRead, back, yesterday).filter(notARequest);

  // Confirmed: promises still to keep, from today on.
  const confirmed =
    upcomingDays === null
      ? null
      : upcomingDays.filter((b) => isUpcomingBooking(b.state));
  /*
    Past: every trip before today whatever became of it, and any from today on
    that is no longer going ahead. Both reads are needed to say that honestly,
    so either failing is a failure of the whole section rather than a shorter
    list nobody is told about.
  */
  const past =
    upcomingDays === null || pastDays === null
      ? null
      : mostRecentFirst(
          uniqueById(
            pastDays,
            upcomingDays.filter((b) => !isUpcomingBooking(b.state)),
          ),
        );

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

      <nav aria-label="On this screen" className="mt-6 flex flex-wrap gap-2">
        <a
          href="#requests"
          className={buttonClass({
            variant: "outline",
            size: "sm",
            block: false,
          })}
        >
          {requests && requests.length > 0
            ? `Requests · ${requests.length}`
            : "Requests"}
        </a>
        <a
          href="#confirmed"
          className={buttonClass({
            variant: "outline",
            size: "sm",
            block: false,
          })}
        >
          Confirmed
        </a>
        <a
          href="#past"
          className={buttonClass({
            variant: "outline",
            size: "sm",
            block: false,
          })}
        >
          Past
        </a>
      </nav>

      <section
        id="requests"
        className="mt-10 scroll-mt-6"
        aria-labelledby="waiting-heading"
      >
        <h2 id="waiting-heading" className="font-display text-3xl">
          Waiting on you
        </h2>
        {/*
          The demo's sentence, kept because it is why answering fast is a
          conversion job and not an admin chore.
        */}
        <p className="text-forest/70 mt-2 text-sm">
          Nobody holds a seat until you say yes. Guests see &ldquo;confirming
          with the operator&rdquo; until you answer. Fast answers are what stop
          them walking to a counter. Soonest to expire first.
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
            <RequestQueue
              requests={requests}
              canAnswer={me.canManage}
              at={at}
              today={today}
              tomorrow={tomorrow}
            />
          )}
        </div>
      </section>

      <section className="mt-14" aria-labelledby="booked-heading">
        <h2 id="booked-heading" className="font-display text-3xl">
          Booked
        </h2>
        <p className="text-forest/70 mt-2 text-sm">
          By the day the trip runs: the last month and the next three.
        </p>

        <div id="confirmed" className="mt-8 scroll-mt-6">
          <h3 className="label text-forest/75">Confirmed</h3>
          {confirmed === null ? (
            <div className="mt-3">
              <Problem
                title="The bookings did not load"
                body="This is us, not you. Try again in a moment. Nothing has changed because of it."
              />
            </div>
          ) : confirmed.length === 0 ? (
            <p className="text-forest/70 mt-3 text-sm">
              Nothing ahead in the next three months.
            </p>
          ) : (
            <div className="mt-3 space-y-6">
              {byMarketDay(confirmed).map((group) => (
                <div key={group.day || "no-time"}>
                  <h4 className="text-base font-bold">
                    {group.day
                      ? dayCaption(group.day, today, tomorrow)
                      : "No time on these yet"}
                  </h4>
                  {/* "Grouped by date, summarised as total bookings and guests." */}
                  <p className="text-forest/70 mt-0.5 text-sm">
                    {`${group.bookings.length} ${group.bookings.length === 1 ? "booking" : "bookings"} · ${group.guests} ${group.guests === 1 ? "guest" : "guests"}`}
                  </p>
                  <ul className="mt-3 space-y-3">
                    {group.bookings.map((b) => (
                      <BookingRow key={b.id} booking={b} dated={false} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          {upcomingRead !== null && upcomingRead.length >= BOOKINGS_PAGE ? (
            <p className="text-forest/70 mt-3 text-xs">
              Only the first {BOOKINGS_PAGE} bookings from today could be read,
              so later trips may be missing from this list.
            </p>
          ) : null}
        </div>

        <div id="past" className="mt-10 scroll-mt-6">
          <h3 className="label text-forest/75">Past</h3>
          {past === null ? (
            <div className="mt-3">
              <Problem
                title="The bookings did not load"
                body="This is us, not you. Try again in a moment. Nothing has changed because of it."
              />
            </div>
          ) : past.length === 0 ? (
            <p className="text-forest/70 mt-3 text-sm">
              Nothing behind you in the last month.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {past.map((b) => (
                <BookingRow key={b.id} booking={b} dated />
              ))}
            </ul>
          )}
          {pastRead !== null && pastRead.length >= BOOKINGS_PAGE ? (
            <p className="text-forest/70 mt-3 text-xs">
              Only {BOOKINGS_PAGE} bookings from the last month could be read,
              so the most recent may be missing from this list.
            </p>
          ) : null}
        </div>
      </section>
    </Screen>
  );
}

/**
 * One booking, linking to its own screen.
 *
 * `dated` says the day as well as the time. Under a day's heading the day is
 * already said, so the row gives the time alone; in Past every row needs both.
 */
function BookingRow({
  booking: b,
  dated,
}: {
  booking: BookingLine;
  dated: boolean;
}) {
  /*
    With its cash — yuvoy-operator#40. A cash booking waiting on the operator
    reads "Collect ₹9,000", never the card sentence "Payment clearing" its
    state would otherwise produce.
  */
  const state = describeBookingState(b.state, b.cash);
  const when = b.startsAt
    ? dated
      ? `${marketDay(b.startsAt, b.timezone)}, ${marketTime(b.startsAt, b.timezone)}`
      : marketTime(b.startsAt, b.timezone)
    : null;

  return (
    <li>
      <Link
        href={`/bookings/${b.id}`}
        className={panelClass(
          "raised",
          "hover:border-forest/40 ease-interaction block transition-colors duration-200",
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          {/*
            The name if we have it, the reference if not. Never a number:
            `contact` carries the name and only the name.
          */}
          <p className="text-base font-bold">{b.name || b.reference}</p>
          {/*
            Mapped, never raw. This list returns `fulfilment_state` verbatim —
            a column value — so an unmapped one renders no chip rather than
            shouting `paid_pending_ops` at somebody.
          */}
          {state ? (
            <Chip tone={state.live ? "accent" : "neutral"}>{state.label}</Chip>
          ) : null}
        </div>
        {b.reference ? (
          <p className="text-forest/70 mt-1 font-mono text-sm tracking-wider">
            {b.reference}
          </p>
        ) : null}
        <p className="text-forest/70 mt-2 text-sm">
          {when ? `${when} · ${b.experience}` : b.experience}
        </p>
        <p className="text-forest/70 mt-1 text-sm">
          {b.guests} {b.guests === 1 ? "guest" : "guests"}
        </p>
        {/*
          Once taken, the row says so and when. While it is owed the chip
          already carries the amount, and a second line saying the same would
          bury the rest of the row.
        */}
        {b.cash?.collected ? (
          <p className="text-forest/70 mt-1 text-sm">
            {describeCash(b.cash, b.timezone)}
          </p>
        ) : null}
      </Link>
    </li>
  );
}
