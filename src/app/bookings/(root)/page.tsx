/*
  This page sits in a `(root)` route group, and the group exists for exactly
  one reason: to SCOPE the loading boundary beside it.

  `/bookings` is a tab root and wants a fallback, so its tap paints in the first
  frame. Its children do not: /bookings/[id] call `notFound()`, and a loading
  boundary makes a route stream — the shell flushes with HTTP 200 before the
  page can set a status, so the 404 becomes a 200 with the not-found screen
  inside it. That was measured, not assumed: the first version of this change
  turned five detail routes into 200s and eleven e2e tests caught it.

  A route group is not part of the URL, so `/bookings` is unchanged, and
  `loading.tsx` in here covers this page alone rather than the whole subtree.
  Sibling components stay in `app/bookings/` because several are shared with those
  child routes; they are imported by their absolute path from here.

  `loading.test.ts` pins all of it.
*/
import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import { listListings } from "@/lib/day/manifest";
import { searchBookings } from "@/lib/money/fetch";
import {
  NO_COUNTS,
  PILL_LABEL,
  VIEWS,
  anyFilter,
  countFor,
  defaultView,
  emptyLine,
  matchesRequest,
  nothingBooked,
  pillHref,
  readFilters,
  readView,
  type View,
} from "@/lib/bookings/list";
import { marketDays, now } from "@/lib/format/market-time";
import { ButtonLink } from "@/components/ui/button";
import { Problem } from "@/components/ui/states";
import { cn } from "@/lib/cn";
import { BookingFilters } from "@/app/bookings/filters";
import { BookingList } from "@/app/bookings/booking-list";
import { NothingBooked } from "@/app/bookings/nothing-booked";
import { PillRow } from "@/app/bookings/pill-row";
import { RequestQueue } from "@/app/bookings/request-queue";
import { RefreshOnFocus } from "@/components/chrome/refresh-on-focus";
import { Screen } from "@/components/chrome/screen";

export const metadata: Metadata = { title: "Bookings" };

/*
  Never prerendered, never cached, and re-read after every answer. Every
  request here has a clock on it and a traveller behind it.
*/
export const dynamic = "force-dynamic";

/**
 * Who has booked — yuvoy-operator#57.
 *
 * ## What this replaced, and why
 *
 * Three anchored sections over two overlapping reads of a fixed window: the
 * last month and the next three, at most a hundred rows each, with a line
 * apologising when a hundred came back. An operator with a busy season could
 * not find a booking from April, and could not find one by name at all.
 *
 * **The server answers the search now** (D-036, yuvoy-api#185). `GET /bookings`
 * takes `q`, `experienceId`, `from` and `to`, answers a page with a cursor, and
 * sends `counts` for all four pills under the same filters. So the four badges
 * are totals rather than counts of what happened to load, and they stay right
 * at any number of bookings.
 *
 * ## The pills, and which one opens
 *
 * Requests · Upcoming · Past · Cancelled, in one row that scrolls sideways.
 * With no `view` in the URL the screen opens on the first of them that has
 * anything in it (yuvoy-operator#83 s4), so a request waiting on an answer
 * still comes first, and a season that is over opens on Past rather than on
 * "Upcoming 0" and a blank screen.
 *
 * ## Requests are not bookings
 *
 * They come from `GET /requests`, they are in no view, and a request that was
 * declined or ran out of time never became a booking, so it is on no pill at
 * all. Their filtering happens in the portal, because that endpoint takes no
 * search — by the same three rules the API counts `counts.requests` by, and by
 * NAME only, because a request has no reference.
 */
export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, me } = await requireOperator();
  const raw = await searchParams;
  const one = (key: string) =>
    Array.isArray(raw[key]) ? raw[key][0] : (raw[key] as string | undefined);

  const asked = readView(one("view"));
  const filters = readFilters({
    q: one("q"),
    experienceId: one("experienceId"),
    from: one("from"),
    to: one("to"),
  });

  const [{ today, tomorrow }, at] = await Promise.all([marketDays(), now()]);

  /*
    Three reads in parallel.

    The bookings read does double duty: on Upcoming, Past and Cancelled it is
    the rows AND the counts; on Requests it asks for one row of `upcoming` and
    uses only the counts, because `counts` "ignores `view`, `state`, `limit` and
    `cursor`" and a hundred rows nobody will draw is a hundred rows of wire.

    Requests are read when the Requests pill is selected or the URL names no
    pill, because the default depends on whether any are waiting.
  */
  const wantsRequests = asked === "requests" || asked === null;
  const listView: "upcoming" | "past" | "cancelled" =
    asked === "past" || asked === "cancelled" ? asked : "upcoming";

  const [first, requests, listings] = await Promise.all([
    searchBookings(token, {
      view: listView,
      ...filters,
      limit: asked === "requests" ? 1 : 100,
    }),
    wantsRequests ? listOpenRequests(token).catch(() => null) : null,
    listListings(token).catch(() => []),
  ]);

  const counts = first?.counts ?? NO_COUNTS;
  const view: View = asked ?? defaultView(counts);
  const filtered = anyFilter(filters);

  /*
    The rows for the pill the counts chose, when that is not the one the first
    read fetched. Only Past and Cancelled can be chosen that way, and only when
    Requests and Upcoming are both empty, so this second read happens on the
    quiet screens and never on a busy morning's. Its own failure is the screen's
    failure: the badges from the first read still stand, the rows do not.
  */
  const page =
    first !== null &&
    asked === null &&
    (view === "past" || view === "cancelled")
      ? await searchBookings(token, { view, ...filters, limit: 100 })
      : first;

  /*
    Nothing at all, under no filter: a new business, or one whose calendar has
    nothing on sale. The one empty state with a way forward rather than a line
    saying so. `page.items` is checked as well as the counts, so rows that
    arrived beside counts that did not can never be called nothing.
  */
  const nothingYet =
    page !== null &&
    !filtered &&
    view !== "requests" &&
    nothingBooked(counts) &&
    page.items.length === 0;

  const listingOptions = [...(listings ?? [])]
    .map((l) => ({ id: l.id ?? "", title: l.title ?? "" }))
    .filter((l) => l.id && l.title)
    .sort((a, b) => a.title.localeCompare(b.title));

  const visibleRequests = (requests ?? []).filter((r) =>
    matchesRequest(r, filters),
  );

  return (
    <Screen>
      <RefreshOnFocus />

      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Bookings
      </h1>

      <BookingFilters
        filters={filters}
        view={view}
        today={today}
        tomorrow={tomorrow}
        listings={listingOptions}
      />

      {/*
        The pills. Links rather than buttons: the URL holds the place, so back
        and refresh restore the pill somebody was on, and a pill can be opened
        in a new tab like anything else on the web. 44px tall, for a wet thumb.

        No badges at all when the read failed. A number from a failed read is
        one an operator would plan against.
      */}
      <PillRow label="Which bookings" selected={view}>
        {VIEWS.map((pill) => {
          const selected = pill === view;
          return (
            <ButtonLink
              key={pill}
              href={pillHref(pill, filters)}
              variant={selected ? "primary" : "secondary"}
              size="md"
              block={false}
              aria-current={selected ? "page" : undefined}
              className={cn(selected && "pointer-events-none")}
            >
              {PILL_LABEL[pill]}
              {first ? (
                <span className="tabular-nums">{countFor(counts, pill)}</span>
              ) : null}
            </ButtonLink>
          );
        })}
      </PillRow>

      {page === null ? (
        /*
          One line and a way back, for every pill. The button is a link to this
          same URL: the route is `force-dynamic`, so navigating to itself
          genuinely re-reads rather than replaying a cached answer.
        */
        <div className="mt-8">
          <Problem
            title="Bookings did not load. Try again."
            body="Nothing has changed. This is us, not you."
          />
          <div className="mt-4">
            <ButtonLink
              href={pillHref(view, filters)}
              variant="secondary"
              block={false}
            >
              Try again
            </ButtonLink>
          </div>
        </div>
      ) : view === "requests" ? (
        <div className="mt-6">
          {/*
            STAFF, on this pill only, in one line. It replaced a `Problem` panel
            at the top of the whole screen, which told somebody who had come to
            read their bookings that they could not do something they had not
            tried.
          */}
          {!me.canManage ? (
            <p className="text-forest/80 text-base font-bold">
              Only owners, admins and managers can answer requests
            </p>
          ) : null}

          {requests === null ? (
            <Problem
              title="Requests did not load. Try again."
              body="Your bookings on the other pills are unaffected."
            />
          ) : visibleRequests.length === 0 ? (
            <p className="text-forest/70 text-base">
              {emptyLine("requests", filtered)}
            </p>
          ) : (
            /*
              The list and its receipts are one client component on purpose: the
              receipt an accept produces has to outlive the row the next refresh
              removes. See `RequestQueue`.
            */
            <RequestQueue
              requests={visibleRequests}
              /*
                Accepting is refused while suspended and declining is not (#50):
                a suspended business can always let a traveller go and can never
                take one on. The row draws Decline either way and drops Accept,
                rather than going read-only and leaving a traveller waiting on
                an answer that cannot come.
              */
              canAnswer={me.canManage}
              canAccept={!me.suspension}
              at={at}
              today={today}
              tomorrow={tomorrow}
            />
          )}

          {visibleRequests.length === 0 && filtered ? (
            <div className="mt-4">
              <ButtonLink
                href={pillHref("requests", {
                  q: "",
                  experienceId: "",
                  from: "",
                  to: "",
                })}
                variant="secondary"
                block={false}
              >
                Clear
              </ButtonLink>
            </div>
          ) : null}
        </div>
      ) : nothingYet ? (
        <NothingBooked />
      ) : (
        <>
          <BookingList
            /*
              Keyed on the query, so switching pill or filter mounts a fresh
              list rather than showing the previous pill's rows under the new
              one until the server answers. The pages already loaded belong to
              the cursor that issued them and cannot be carried across.
            */
            key={pillHref(view, filters)}
            view={view}
            filters={filters}
            initial={page}
            today={today}
            tomorrow={tomorrow}
          />
          {page.items.length === 0 && filtered ? (
            <div className="mt-4">
              <ButtonLink
                href={pillHref(view, {
                  q: "",
                  experienceId: "",
                  from: "",
                  to: "",
                })}
                variant="secondary"
                block={false}
              >
                Clear
              </ButtonLink>
            </div>
          ) : null}
        </>
      )}
    </Screen>
  );
}
