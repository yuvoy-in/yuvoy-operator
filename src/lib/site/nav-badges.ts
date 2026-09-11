import "server-only";
import { readMe, readSessionToken } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import { standingOf } from "@/lib/account/standing";
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
  let token: string | null;
  try {
    token = await readSessionToken();
  } catch {
    return {};
  }
  if (!token) return {};

  const [me, requests] = await Promise.allSettled([
    readMe(token),
    listOpenRequests(token),
  ]);

  return countBadges({
    account: me.status === "fulfilled" ? standingOf(me.value.account) : null,
    requests: requests.status === "fulfilled" ? requests.value : undefined,
  });
}
