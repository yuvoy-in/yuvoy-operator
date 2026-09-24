import { stoppingSales, type Standing } from "@/lib/account/standing";
import type { NavBadges } from "./nav";

/**
 * The two counts on the bar, from what the two screens themselves read —
 * yuvoy-operator#42.
 *
 * Each is the number of rows under "Waiting on you" on the screen its stop
 * opens, computed the same way that screen computes them:
 *
 *   - **Bookings** — every open seat request. `/bookings` renders the whole
 *     `GET /requests` list as its queue, STAFF included: they cannot answer
 *     one, but "a request nobody sees is a request that expires".
 *   - **Business** — what stops the business selling that this login can act
 *     on (`stoppingSales`), the rows Home's "Needs you" leads with. It counted
 *     every item waiting on the operator, and yuvoy-operator#96 item 6 named
 *     the result: "The Business badge reads '2' (two non-blocking
 *     verification items)", a label that does not scan. Items that stop
 *     nothing are still listed on Business and in Needs you, with no badge;
 *     something sitting with Yuvoy, or that only an owner, admin or manager
 *     can do, is not this login's to act on, and a badge that counted it
 *     would send them to a screen with nothing to do.
 *
 * **A source that could not be read contributes no key**, never a zero. Zero
 * and unknown both draw nothing, and only one of them is true.
 */
export function countBadges(from: {
  account: Standing | null | undefined;
  /** OWNER, ADMIN or MANAGER. `false` when `/me` did not say. */
  canManage: boolean;
  requests: readonly unknown[] | undefined;
}): NavBadges {
  const counts: NavBadges = {};
  if (from.requests) counts.bookings = from.requests.length;
  if (from.account) {
    counts.business = stoppingSales(from.account, from.canManage).length;
  }
  return counts;
}
