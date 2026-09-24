/*
  This page sits in a `(root)` route group, and the group exists for exactly
  one reason: to SCOPE the loading boundary beside it.

  `/today` is a tab root and wants a fallback, so its tap paints in the first
  frame. Its children do not: /today/[slotId] and /today/listing/[id] call
  `notFound()`, and a loading boundary makes a route stream: the shell flushes
  with HTTP 200 before the page can set a status, so the 404 becomes a 200
  with the not-found screen inside it. That was measured, not assumed: the
  first version of this change turned five detail routes into 200s and eleven
  e2e tests caught it.

  A route group is not part of the URL, so `/today` is unchanged, and
  `loading.tsx` in here covers this page alone rather than the whole subtree.
  Sibling components stay in `app/today/` because several are shared with those
  child routes; they are imported by their absolute path from here.

  `loading.test.ts` pins all of it.
*/
import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import { listSlots } from "@/lib/day/manifest";
import type { OperatorSlot } from "@/lib/day/types";
import { departuresOn, shiftDay } from "@/lib/day/calendar";
import { marketDays, now } from "@/lib/format/market-time";
import { readInbox } from "@/lib/site/inbox";
import { isNewOperator, startSelling, stepsLeft } from "@/lib/home/checklist";
import {
  cashToCollect,
  emptyToday,
  NEXT_WITHIN_DAYS,
  nextRunning,
  peopleOn,
  runDay,
} from "@/lib/home/day";
import {
  readHomeListings,
  readManifests,
  readMoneyToday,
  readEverBooked,
  readReelCount,
} from "@/lib/home/fetch";
import { listingsGlance } from "@/lib/home/listings";
import { moneyLine } from "@/lib/home/money";
import { needsYou, type TodayCash } from "@/lib/home/needs";
import { sellingStatus } from "@/lib/home/status";
import { Screen } from "@/components/chrome/screen";
import { RefreshOnFocus } from "@/components/chrome/refresh-on-focus";
import { StatusLine } from "./status-line";
import { NeedsYou } from "./needs-you";
import { DaySheet } from "./day-sheet";
import { Glance, MoneyGlance } from "./glance";
import { StartSelling } from "./start-selling";

export const metadata: Metadata = { title: "Today" };

/*
  Never prerendered, never cached: every number here is a live seat count or a
  request with a clock on it.
*/
export const dynamic = "force-dynamic";

/**
 * Home: run today, miss nothing (yuvoy-operator#96, #82).
 *
 * Top to bottom, in the order an operator needs them at six in the morning:
 *
 *   1. Whether the business is selling, in one line, always.
 *   2. What needs them, sorted by deadline, one action a row, and nothing at
 *      all when nothing is waiting.
 *   3. Today's departures, always, with Tomorrow one tap away.
 *   4. Money today, for a login that can manage.
 *   5. The listings at a glance, opening Business.
 *
 * A business that has never had anything on sale gets the start-selling
 * checklist in place of 3 to 5, and one that cannot sell leads 1 and 2 with
 * why and with the one thing that fixes it.
 *
 * ## Nothing here explains itself
 *
 * One heading per block, and a sentence only for an error, an empty day, or
 * the consequence of a tap (yuvoy-operator#80 t4). The listing list left: it
 * grew with the business and pushed the day down, and Business already has it.
 *
 * ## One bar of signal
 *
 * Every read starts at once and each fails on its own: a read that did not
 * answer hides or explains its own block and never blanks the screen. Nothing
 * is read per listing. Both days are one `GET /slots`, `/me`, `/requests` and
 * the inbox are the reads the root layout already made (each `cache`d for
 * the request), and the only per-row reads are the manifests of TODAY's
 * departures that have somebody on them, started the moment the day's
 * departures arrive rather than after everything else.
 */
export default async function HomePage() {
  const { token, me } = await requireOperator();
  const [{ today, tomorrow }, at] = await Promise.all([marketDays(), now()]);

  const slots = listSlots(token, today, tomorrow).then(
    (rows) => rows,
    () => null,
  );
  const manifests = slots.then((rows) =>
    rows ? readManifests(token, departuresOn(rows, today)) : new Map(),
  );

  const [requests, listings, days, dayManifests, inbox, money] =
    await Promise.all([
      listOpenRequests(token).catch(() => null),
      readHomeListings(token),
      slots,
      manifests,
      readInbox(token),
      /*
        Every money read refuses STAFF, so a staff login does not ask: a
        refusal read on their behalf is a request spent on the one bar of
        signal to learn nothing.
      */
      me.canManage ? readMoneyToday(token) : Promise.resolve(null),
    ]);

  const todaySlots = days ? departuresOn(days, today) : [];
  const tomorrowSlots = days ? departuresOn(days, tomorrow) : [];
  const todaySheet = days
    ? runDay({
        caption: "Today",
        slots: todaySlots,
        listings,
        manifests: dayManifests,
        now: at,
      })
    : null;
  const tomorrowSheet = days
    ? runDay({
        caption: "Tomorrow",
        slots: tomorrowSlots,
        listings,
        now: at,
      })
    : null;

  /*
    Cash still to take on today's departures, from the manifests the sheet
    already read. The rows the sheet leaves out are left out here too: a
    called-off departure's parties are not on the boat.
  */
  const shownToday = new Set(todaySheet?.rows.map((r) => r.id));
  const cash: TodayCash[] = todaySlots.flatMap((slot) => {
    const manifest = dayManifests.get(slot.id);
    if (!manifest || !shownToday.has(slot.id)) return [];
    const owed = cashToCollect(manifest);
    return owed.parties > 0
      ? [
          {
            slotId: slot.id,
            startsAt: slot.startsAt,
            timezone: slot.timezone,
            title: slot.title,
            parties: owed.parties,
            collectPaise: owed.collectPaise,
          },
        ]
      : [];
  });

  const suspended = me.suspension !== null;
  const status = sellingStatus({
    standing: me.account,
    suspension: me.suspension,
    listings,
    canManage: me.canManage,
  });
  const needs = needsYou({
    standing: me.account,
    suspended,
    canManage: me.canManage,
    requests,
    listings,
    cash,
    unrecorded: money?.unrecorded ?? null,
    inbox,
    today,
    now: at,
  });

  /*
    A business that has never been booked gets the checklist in place of the
    day, the money and the listings, until its first sale or its last step
    (see `lib/home/checklist.ts`). The count is read only when nobody is on
    either day read, and the reels only for a business that is new.
  */
  const peopleOnDaysRead = [...todaySlots, ...tomorrowSlots].some(
    (s) => peopleOn(s) > 0,
  );
  const fresh =
    listings !== null &&
    !peopleOnDaysRead &&
    isNewOperator({
      listings,
      peopleOnDaysRead,
      everBooked: await readEverBooked(token),
    });
  const checklist =
    fresh && listings
      ? startSelling({
          standing: me.account,
          listings,
          reels: await readReelCount(token),
          canManage: me.canManage,
        })
      : null;
  const steps = checklist && stepsLeft(checklist) ? checklist : null;

  /*
    "Nothing running today. Next: Thu 09:00" (#96 block 3). Tomorrow's rows
    answer it most days. Only when tomorrow has nothing either is the rest of
    the next 30 days read, once, and a read that fails claims nothing.
  */
  let next: OperatorSlot | null | undefined;
  if (todaySheet && todaySheet.rows.length === 0 && !steps) {
    next = nextRunning(tomorrowSlots, listings, at);
    if (next === null) {
      next = await listSlots(
        token,
        shiftDay(today, 2),
        shiftDay(today, NEXT_WITHIN_DAYS - 1),
      ).then(
        (later) => nextRunning(later, listings, at),
        () => undefined,
      );
    }
  }

  return (
    <Screen>
      <RefreshOnFocus />

      {/*
        One `h1`, and it is not on screen. The screen does not name itself in
        large type (yuvoy-operator#80 t2); the first thing drawn is whether the
        business is selling. It stays in the document, because a page without
        one is a page a screen reader cannot orient in.
      */}
      <h1 className="sr-only">Today</h1>

      <StatusLine status={status} />

      {/*
        Always rendered, and it draws nothing when nothing is waiting: it holds
        the receipts of what was just done, which must outlive the rows they
        came from. See `needs-you.tsx`.
      */}
      <NeedsYou needs={needs} canAccept={me.canManage && !suspended} />

      {steps ? (
        <StartSelling steps={steps} />
      ) : (
        <>
          <DaySheet
            today={todaySheet}
            tomorrow={tomorrowSheet}
            emptyToday={emptyToday(next, today)}
          />

          {me.canManage ? (
            <MoneyGlance
              line={
                money
                  ? moneyLine({
                      week: money.week,
                      owedPaise: money.owedPaise,
                      today,
                    })
                  : null
              }
            />
          ) : null}

          <Glance
            id="home-listings"
            heading="Listings"
            href="/account"
            text={listings ? listingsGlance(listings) : "Listings did not load"}
            tone={listings ? "plain" : "alert"}
          />
        </>
      )}
    </Screen>
  );
}
