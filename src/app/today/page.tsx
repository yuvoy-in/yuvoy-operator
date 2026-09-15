import type { Metadata } from "next";
import Link from "next/link";
import { requireOperator } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import { listListings, listMedia, listSlots } from "@/lib/day/manifest";
import { urgencyOf } from "@/lib/day/request-types";
import { headline } from "@/lib/account/standing";
import { totalUnread } from "@/lib/messages/fetch";
import { unreadLabel } from "@/lib/messages/thread";
import {
  dayLine,
  listingLabel,
  nextDeparture,
  orderListings,
  posterFor,
  requestsLine,
  seatsLine,
} from "@/lib/services/home";
import { shiftDay } from "@/lib/day/calendar";
import {
  dayCaption,
  marketDays,
  marketTime,
  now,
} from "@/lib/format/market-time";
import { ButtonLink } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { Screen } from "@/components/chrome/screen";
import { RefreshOnFocus } from "@/components/chrome/refresh-on-focus";
import { cn } from "@/lib/cn";
import type { OperatorSlot } from "@/lib/day/types";

export const metadata: Metadata = { title: "Home" };

/*
  Never prerendered, never cached: every number here is a live seat count or a
  request with a clock on it.
*/
export const dynamic = "force-dynamic";

/**
 * Home — yuvoy-operator#56.
 *
 * ## What this screen is for
 *
 * One glance, at six in the morning, on one bar of signal: what is waiting on
 * an answer, what is running today, and every listing with its state. It was
 * Today, which showed the day and nothing else, while the listings lived behind
 * a tab nobody found and the requests behind another.
 *
 * ## Nothing here explains itself
 *
 * One heading per block, and body text only for an error or an empty day
 * (`Do not build`). The previous screen opened with the operator's own name and
 * a paragraph about what a manifest is. Neither is information; both are
 * between an operator and the boat.
 *
 * ## The fortnight is read ONCE
 *
 * "Never one call per listing", and the issue says it twice. Nine listings
 * would otherwise be nine slot requests on the screen somebody opens first.
 * `nextDeparture` finds each listing's next boat inside the one read.
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  const { token, me } = await requireOperator();
  const { day } = await searchParams;

  const { today, tomorrow } = await marketDays();
  // Only ever today or tomorrow from the UI, but the value arrives in a URL,
  // so it is validated rather than trusted.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day ?? "") ? day! : today;
  const fortnightEnd = shiftDay(today, 13);

  /*
    Six reads, in parallel, and none of them can take the screen down on its
    own: every one degrades to a line of its own rather than an error page.

    The fortnight covers BOTH the day's rows and every listing's next
    departure, which is why it is asked for once and sliced twice.
  */
  const [daySlots, fortnight, listings, media, requests, unreadTotal, at] =
    await Promise.all([
      listSlots(token, date, date).then(
        (rows) => ({ ok: true as const, rows }),
        () => ({ ok: false as const, rows: [] }),
      ),
      listSlots(token, today, fortnightEnd).catch(() => []),
      listListings(token).catch(() => []),
      listMedia(token).catch(() => []),
      listOpenRequests(token).catch(() => null),
      totalUnread(token),
      now(),
    ]);

  /*
    `me.account` is already a narrowed `Standing | null` — `null` when the API
    sent no account block at all, which the contract says is "unknown, never
    everything is fine". A screen that read that as fine would tell somebody who
    cannot sell that they can.
  */
  const standing = me.account;
  const urgent = (requests ?? []).filter(
    (r) => urgencyOf(r.minutesToAnswer ?? 0) === "critical",
  ).length;
  const waiting = requestsLine((requests ?? []).length, urgent);
  const ordered = orderListings(listings ?? []);
  const caption = dayCaption(date, today, tomorrow);

  return (
    <Screen>
      <RefreshOnFocus />

      {/*
        One `h1`, and it is not on screen. The heading an operator needs is the
        day's line below; a second one saying "Home" above it is the screen
        naming itself. It stays in the document because a page without one is a
        page a screen reader cannot orient in.
      */}
      <h1 className="sr-only">Home</h1>

      {/*
        The account, first, and only when it cannot sell. `headline` is the one
        sentence Verification leads with, so the two cannot disagree about what
        is wrong — and the strip opens that screen rather than the profile,
        because the outstanding list is what it is promising.
      */}
      {standing && !standing.bookable ? (
        <Link href="/account/verification" className={stripClass("alert")}>
          <span className="text-base font-bold">
            {headline(standing).title}
          </span>
          <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
        </Link>
      ) : null}

      {/*
        Requests, which are the only thing on this screen with a clock on them.
        A failed read says so rather than showing nothing: an empty strip and a
        broken one look identical, and one of them is a queue expiring.
      */}
      {requests === null ? (
        <Link href="/bookings?view=requests" className={stripClass("alert")}>
          <span className="text-base font-bold">
            Requests did not load. Open Bookings
          </span>
          <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
        </Link>
      ) : waiting ? (
        <Link href="/bookings?view=requests" className={stripClass("alert")}>
          <span className="text-base font-bold">{waiting}</span>
          <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
        </Link>
      ) : null}

      {/*
        Unread messages, directly under the requests strip, by the owner's
        decision of 14 September (yuvoy-operator#52 item 4). Quieter on purpose:
        a request expires and a message waits.
      */}
      {unreadTotal > 0 ? (
        <Link href="/messages" className={stripClass("raised")}>
          <span className="text-base font-bold">
            {unreadLabel(unreadTotal)}
          </span>
          <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
        </Link>
      ) : null}

      <nav className="mt-6 flex flex-wrap gap-2" aria-label="Which day">
        <DayLink label="Today" href="/today" active={date === today} />
        <DayLink
          label="Tomorrow"
          href={`/today?day=${tomorrow}`}
          active={date === tomorrow}
        />
      </nav>

      <section className="mt-5" aria-labelledby="the-day">
        <h2 id="the-day" className="label text-forest/75">
          {dayLine(caption, daySlots.rows)}
        </h2>

        {!daySlots.ok ? (
          <div className="mt-3">
            <p className="text-terra-deep text-base font-bold">
              Departures did not load. Try again.
            </p>
            <ButtonLink
              href={date === today ? "/today" : `/today?day=${date}`}
              variant="secondary"
              block={false}
              className="mt-3"
            >
              Try again
            </ButtonLink>
          </div>
        ) : daySlots.rows.length === 0 ? (
          /*
            One line. The panel that stood here explained what a departure is
            and what to do about not having one, on the screen an operator opens
            when they already know.
          */
          <p className="text-forest/70 mt-2 text-base">
            {date === tomorrow
              ? "Nothing running tomorrow"
              : "Nothing running today"}
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {daySlots.rows.map((slot: OperatorSlot) => (
              <li key={slot.id}>
                <Link
                  href={`/today/${slot.id}`}
                  className={panelClass(
                    "raised",
                    "ease-interaction hover:bg-cream flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-200",
                  )}
                >
                  <span className="flex min-w-0 items-baseline gap-3">
                    <span className="shrink-0 font-mono text-sm tabular-nums">
                      {marketTime(slot.startsAt, slot.timezone)}
                    </span>
                    <span className="truncate text-base font-bold">
                      {slot.title}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "label",
                        slot.status === "cancelled"
                          ? "text-terra-deep"
                          : "text-forest/75",
                      )}
                    >
                      {seatsLine(slot)}
                    </span>
                    <ChevronRightIcon className="text-terra-deep size-5" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10" aria-labelledby="listings">
        <h2 id="listings" className="label text-forest/75">
          Your listings
        </h2>

        {ordered.length === 0 ? (
          <Link
            href="/account"
            className="text-terra-deep tap-target mt-2 block text-base font-bold underline underline-offset-4"
          >
            No listings yet
          </Link>
        ) : (
          <ul className="mt-3 space-y-2">
            {ordered.map((listing) => {
              const id = listing.id ?? "";
              const next = nextDeparture(fortnight, id, at);
              const poster = posterFor(media, id);
              return (
                <li key={id}>
                  <Link
                    href={`/today/listing/${id}`}
                    className={panelClass(
                      "raised",
                      "ease-interaction hover:bg-cream flex items-center gap-3 px-4 py-3 transition-colors duration-200",
                    )}
                  >
                    {/*
                      A blank tile rather than a placeholder photograph.
                      `OperatorMedia` has no hero field yet, and a stand-in
                      picture on a listing is a picture of somebody else's boat.
                    */}
                    {poster ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={poster}
                        alt=""
                        className="rounded-control size-12 shrink-0 object-cover"
                      />
                    ) : (
                      <span
                        aria-hidden
                        className="rounded-control bg-cream-deep size-12 shrink-0"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-bold">
                        {listing.title}
                      </span>
                      {next ? (
                        <span className="text-forest/70 block truncate text-sm">
                          Next:{" "}
                          {dayCaption(
                            marketDayOfSlot(next.startsAt, next.timezone),
                            today,
                            tomorrow,
                          )}{" "}
                          {marketTime(next.startsAt, next.timezone)} ·{" "}
                          {next.sold}/{next.seats}
                        </span>
                      ) : null}
                    </span>
                    <Chip>{listingLabel(listing)}</Chip>
                    <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Screen>
  );
}

/** The market day a departure falls on, for its caption. */
function marketDayOfSlot(startsAt: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(
    new Date(startsAt),
  );
}

/** A full-width strip: one line, a chevron, and the whole thing a tap target. */
function stripClass(tone: "alert" | "raised"): string {
  return panelClass(
    tone,
    "ease-interaction hover:bg-cream mt-3 flex items-center justify-between gap-4 p-4 transition-colors duration-200",
  );
}

function DayLink({
  label,
  href,
  active,
}: {
  label: string;
  href: string;
  active: boolean;
}) {
  return (
    <ButtonLink
      href={href}
      variant={active ? "primary" : "secondary"}
      size="sm"
      block={false}
      aria-current={active ? "page" : undefined}
    >
      {label}
    </ButtonLink>
  );
}
