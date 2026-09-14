import "server-only";
import { readMe, readSessionToken } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import {
  standingOf,
  suspensionOf,
  type Suspension,
} from "@/lib/account/standing";
import { countBadges } from "./badge-counts";
import type { NavBadges } from "./nav";

/**
 * The bar's two counts, read on the server for the root layout —
 * yuvoy-operator#42.
 *
 * ## It never throws, and it never guesses
 *
 * This runs under EVERY page, the sign-in door and the 404 included, so a
 * failure here must cost a badge and nothing else. No cookie, a dead session,
 * an account on hold, a dropped connection: each contributes no count, and
 * the page renders exactly as it would have without badges at all.
 *
 * ## It costs one request, not two
 *
 * `readMe` and `listOpenRequests` are both `cache`d for the request, and every
 * authenticated page already asks `GET /me` through `requireOperator()` — as
 * Today and Bookings already ask `GET /requests`. So on those screens this
 * reads what the page reads, once; elsewhere it adds the one `GET /requests`
 * the Bookings badge needs, in parallel with the page's own work.
 *
 * ## How fresh it is
 *
 * As fresh as the render. A layout is not re-rendered by a client-side
 * navigation, so after answering a request somewhere without a refresh the
 * count can trail the queue for a moment — until the next Server Action that
 * revalidates, `RefreshOnFocus` on the day and bookings screens, or any full
 * load. The screen the stop opens is always the authority; the badge is the
 * nudge to open it.
 */
export async function navBadges(): Promise<NavBadges> {
  return (await chromeData()).badges;
}

/**
 * Everything the chassis needs from the server, from the one `GET /me` the
 * badges already cost.
 *
 * The suspension banner rides here rather than making a second call
 * (yuvoy-operator#50). It has to appear on EVERY signed-in screen, so the
 * layout is the only place it can be drawn once, and the layout already reads
 * `/me` for the badges. A separate read would double the request on every
 * page to learn something the first response already carried.
 *
 * The same rule as the badges holds: a failure costs the banner, never the
 * page. An operator whose `/me` did not answer sees the portal they always
 * saw, which is the right failure. The wrong one is a blank page over a field
 * nobody could read.
 */
export async function chromeData(): Promise<{
  badges: NavBadges;
  suspension: NonNullable<Suspension> | null;
}> {
  let token: string | null;
  try {
    token = await readSessionToken();
  } catch {
    return { badges: {}, suspension: null };
  }
  if (!token) return { badges: {}, suspension: null };

  const [me, requests] = await Promise.allSettled([
    readMe(token),
    listOpenRequests(token),
  ]);

  const account = me.status === "fulfilled" ? me.value.account : undefined;
  return {
    badges: countBadges({
      account: account ? standingOf(account) : null,
      requests: requests.status === "fulfilled" ? requests.value : undefined,
    }),
    suspension: suspensionOf(account),
  };
}
