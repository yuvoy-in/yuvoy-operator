import { splitByWaitingOn, type Standing } from "@/lib/account/standing";
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
 *   - **Business** — every blocker whose `waitingOn` is `operator`. `/account`
 *     splits the list the same way and renders only those under its heading;
 *     something sitting with Yuvoy is not the operator's work queue, and a
 *     badge that counted it would send them to a screen with nothing to do.
 *
 * The demo counts "missing required verification documents". The Business
 * screen's queue is wider than documents — a logo and a registered address are
 * the operator's to finish too — and a badge disagreeing with the list it
 * opens is worse than either number.
 *
 * **A source that could not be read contributes no key**, never a zero. Zero
 * and unknown both draw nothing, and only one of them is true.
 */
export function countBadges(from: {
  account: Standing | null | undefined;
  requests: readonly unknown[] | undefined;
}): NavBadges {
  const counts: NavBadges = {};
  if (from.requests) counts.bookings = from.requests.length;
  if (from.account) {
    counts.business = splitByWaitingOn(from.account.blocking).operator.length;
  }
  return counts;
}
