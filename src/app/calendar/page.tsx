import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import {
  getManifest,
  listClosures,
  listListings,
  listSlots,
} from "@/lib/day/manifest";
import {
  confirmedGuestsByDay,
  departuresOn,
  shiftDay,
} from "@/lib/day/calendar";
import {
  boardHref,
  boardRows,
  readDay,
  readWeek,
  weekDays,
  weekLine,
} from "@/lib/day/board";
import { wholeDayClosures } from "@/lib/day/closures";
import { seatsUnconfirmed } from "@/lib/day/off-sale";
import { listOpenRequests } from "@/lib/day/requests";
import { requestView } from "@/lib/day/request-view";
import { listBookings } from "@/lib/money/fetch";
import { dayCaption, marketDays, now } from "@/lib/format/market-time";
import { ConfirmSeats } from "@/components/listings/confirm-seats";
import { Screen } from "@/components/chrome/screen";
import { RefreshOnFocus } from "@/components/chrome/refresh-on-focus";
import { Problem } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { OnlineOnly } from "@/components/ui/online-only";
import { ReadOnlyWhenOffline } from "@/components/chrome/read-only-when-offline";
import { BlackoutForm } from "./blackout-form";
import { BoardGrid } from "./board-grid";
import { DaySection } from "./day-section";
import { DepartureForm } from "./departure-form";
import { DepartureInspector } from "./inspector";
import { WeekNav } from "./week-nav";
import { WeekStrip } from "./week-strip";

export const metadata: Metadata = { title: "Calendar" };

/*
  Never prerendered, never cached: every number on this page is a live seat
  count, and a stale one is what oversells a boat.
*/
export const dynamic = "force-dynamic";

/**
 * O9, as a board: every listing by day, any week (operator experiment B's
 * board, approved 3 Oct 2026 as the Calendar, its name kept: #32, D-031
 * C10). "The single most important number in the system."
 *
 * ## Any week, not a fortnight (audit 5.1)
 *
 * The screen it replaces showed today and the next thirteen days and nothing
 * else, so yesterday's departures could not be closed out and one three weeks
 * away could not have its seats changed, be stopped or be called off. The API
 * takes any range; the board reads a week and pages by week, a season either
 * side, with "This week" always one tap away.
 *
 * ## One state, in the URL
 *
 * `week` (its Monday), `day` (open below the board, and on a phone under the
 * strip) and `dep` (the departure open in the inspector). Back, a refresh
 * and a pasted link all land on the same view, and the inspector is a server
 * render of the departure the URL names, so its seat count is as live as the
 * board's.
 *
 * ## What the reads are
 *
 * The week's departures, the listings (rows, and the add-departures form),
 * the week's closures, who is confirmed each day (the closing sentence), the
 * four weeks before today (the honest analytic: seats sold of seats offered),
 * and the requests waiting (the cells say so; the inspector answers them).
 * Each one degrades on its own. The manifest is read only for an open
 * departure.
 *
 * **Calendar controls sellable capacity; Bookings owns customer obligation
 * resolution.** Closing here stops new sales and cancels nobody.
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [query, { token, me }, { today, tomorrow }, at] = await Promise.all([
    searchParams,
    requireOperator(),
    marketDays(),
    now(),
  ]);
  const one = (key: string) =>
    Array.isArray(query[key]) ? query[key][0] : query[key];

  /*
    The week the URL asks for, or the one a `day` is in when only the day is
    given (a link to "Saturday" lands on Saturday's week).
  */
  const asked = one("week") ?? one("day");
  const week = readWeek(asked, today);
  const days = weekDays(week);
  const day = readDay(one("day"), days, today);
  const first = days[0];
  const last = days[days.length - 1];

  const [slots, listings, closures, bookings, past, requests] =
    await Promise.all([
      listSlots(token, first, last).catch(() => null),
      listListings(token),
      // A failed closures read costs the marks, never the board.
      listClosures(token, first, last).catch(() => []),
      listBookings(token, first, last).catch(() => null),
      listSlots(token, shiftDay(today, -28), shiftDay(today, -1)).catch(
        () => null,
      ),
      listOpenRequests(token).catch(() => null),
    ]);

  /*
    NOTHING that writes survives a suspension (yuvoy-operator#50), and a STAFF
    login is offered none of the rest: every write here is OWNER, ADMIN or
    MANAGER except a counter sale, which everybody signed in may record
    (yuvoy-api#226; owner ruling, 23 Sep 2026).
  */
  const canWrite = me.canManage && !me.suspension;
  const canSellAtCounter = !me.suspension;

  const waiting = new Map<string, number>();
  for (const request of requests ?? []) {
    if (request.slotId) {
      waiting.set(request.slotId, (waiting.get(request.slotId) ?? 0) + 1);
    }
  }

  const rows = slots
    ? boardRows({
        listings,
        slots,
        past,
        closures,
        days,
        waiting,
        now: at,
      })
    : [];
  const guests = bookings ? confirmedGuestsByDay(bookings, days) : null;
  const closedDays = new Set(
    days.filter((d) => wholeDayClosures(closures, d).length > 0),
  );
  const unconfirmed = (slots ?? []).filter(seatsUnconfirmed).length;

  // The open departure, when the URL names one this week holds.
  const depId = one("dep");
  const opened = depId ? (slots ?? []).find((s) => s.id === depId) : undefined;
  const openedDay = opened
    ? (days.find((d) => departuresOn([opened], d).length > 0) ?? day)
    : day;
  const manifest = opened
    ? await getManifest(token, opened.id).catch(() => null)
    : null;
  const here = boardHref({ week, day: openedDay, dep: opened?.id }, today);
  const closeHref = boardHref({ week, day: openedDay }, today);

  const dayDepartures = slots ? departuresOn(slots, day) : [];
  const dayCells = rows
    .flatMap((row) => row.days.find((d) => d.day === day)?.departures ?? [])
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));

  return (
    <Screen width="xl">
      <RefreshOnFocus />

      {/* "Calendar", not "Capacity" or "Board": yuvoy-operator#32, #36. */}
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Calendar
      </h1>

      {/*
        One line for a staff login, saying who can change this, rather than a
        panel headed as though something had gone wrong (#45 item 7).
      */}
      {!me.canManage ? (
        <p className="text-forest/80 mt-3 text-base">
          Only owners, admins and managers can change seats or close dates.
        </p>
      ) : null}

      {/*
        Readable with no signal, and says so; nothing that changes something
        can be pressed until it is back (operator experiment B's offline
        state). See `ReadOnlyWhenOffline` and `OnlineOnly`.
      */}
      <ReadOnlyWhenOffline what="The calendar">
        <OnlineOnly>
          {canWrite ? (
            <div className="mt-6">
              <ConfirmSeats notOnSale={unconfirmed} goingOffSoon={0} />
            </div>
          ) : null}

          {/*
        Adding comes before closing, and both before the board: is there a
        departure for Saturday, is the week off, and what does the week look
        like. Both are collapsed until pressed, and closing is the quiet one,
        because it stops sales (#81).
      */}
          {canWrite ? (
            <div className="mt-6 space-y-3">
              <DepartureForm listings={listings} today={today} />
              <BlackoutForm today={today} />
            </div>
          ) : null}
        </OnlineOnly>

        <section className="mt-10" aria-labelledby="board-week">
          <WeekNav
            week={week}
            days={days}
            today={today}
            summary={slots ? weekLine(slots) : null}
          />

          {slots === null ? (
            <div className="mt-5">
              {/*
              The week did not load; everything else on the page did, and the
              way to the weeks either side still works.
            */}
              <Problem
                title="That week did not load"
                body="Nothing has changed. Try again in a moment."
              />
              <div className="mt-4">
                <ButtonLink
                  href={boardHref({ week, day }, today)}
                  variant="secondary"
                  block={false}
                >
                  Try again
                </ButtonLink>
              </div>
            </div>
          ) : (
            <>
              <WeekStrip
                week={week}
                days={days}
                day={day}
                today={today}
                rows={rows}
              />

              {rows.length === 0 ? (
                <p className="text-forest/80 mt-5 text-base">
                  Nothing scheduled this week
                </p>
              ) : (
                <BoardGrid
                  week={week}
                  days={days}
                  day={day}
                  today={today}
                  rows={rows}
                  closedDays={closedDays}
                />
              )}

              <OnlineOnly>
                <DaySection
                  week={week}
                  day={day}
                  today={today}
                  label={dayCaption(day, today, tomorrow)}
                  departures={dayDepartures}
                  cells={dayCells}
                  guests={guests ? (guests.get(day) ?? 0) : null}
                  closures={closures}
                  canManage={canWrite}
                />
              </OnlineOnly>
            </>
          )}
        </section>

        {opened ? (
          <DepartureInspector
            slot={opened}
            day={openedDay}
            manifest={manifest}
            requests={(requests ?? [])
              .filter((r) => r.slotId === opened.id)
              .map((r) => requestView(r, { at, today, tomorrow }))}
            here={here}
            closeHref={closeHref}
            canManage={me.canManage}
            canWrite={canWrite}
            canSellAtCounter={canSellAtCounter}
          />
        ) : null}
      </ReadOnlyWhenOffline>
    </Screen>
  );
}
