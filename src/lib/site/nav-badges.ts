import "server-only";
import { readMe, readSessionToken } from "@/lib/auth/session";
import { listOpenRequests } from "@/lib/day/requests";
import {
  standingOf,
  suspensionOf,
  type Suspension,
} from "@/lib/account/standing";
import { countBadges } from "./badge-counts";
import { readBusinessName } from "./business-name";
import { readInbox } from "./inbox";
import type { NavBadges } from "./nav";

/**
 * The bar's two counts, read on the server for the root layout,
 * yuvoy-operator#42.
 *
 * ## It never throws, and it never guesses
 *
 * This runs under EVERY page, the sign-in door and the 404 included, so a
 * failure here must cost a badge and nothing else. No cookie, a dead session,
 * an account on hold, a dropped connection: each contributes no count, and
 * the page renders exactly as it would have without badges at all.
 *
 * ## How fresh it is
 *
 * As fresh as the render. A layout is not re-rendered by a client-side
 * navigation, so after answering a request somewhere without a refresh the
 * count can trail the queue for a moment: until the next Server Action that
 * revalidates, `RefreshOnFocus` on the day and bookings screens, or any full
 * load. The screen the stop opens is always the authority; the badge is the
 * nudge to open it.
 */
export async function navBadges(): Promise<NavBadges> {
  return (await chromeData()).badges;
}

/** Everything the chassis needs from the server, for the root layout. */
export interface ChromeData {
  badges: NavBadges;
  suspension: NonNullable<Suspension> | null;
  /**
   * What the stage and the rail call the business (yuvoy-operator#80 t1), or
   * `null` when it is unknown and the mark is drawn alone.
   */
  businessName: string | null;
  /**
   * OWNER, ADMIN or MANAGER: whether the Money stop is drawn
   * (yuvoy-operator#96). `false` when `/me` did not answer, because a stop
   * that opens onto a refusal is worse than one that appears on the next load.
   */
  canManage: boolean;
  /**
   * Conversations with a message nobody has read, for the inbox control on
   * the stage: one guest waiting on a reply each, the same count Home's
   * "Needs you" says. Absent when the read failed: unknown, never zero.
   */
  unread?: number;
}

const SIGNED_OUT: ChromeData = {
  badges: {},
  suspension: null,
  businessName: null,
  canManage: false,
};

/**
 * Everything the chassis needs from the server, read in ONE parallel wave.
 *
 * The suspension banner rides here rather than making a second call
 * (yuvoy-operator#50): it has to appear on EVERY signed-in screen, so the
 * layout is the only place it can be drawn once, and the layout already reads
 * `/me` for the badges. The business name and the inbox count joined it for
 * yuvoy-operator#80 t1 and #96, for the same reason and in the same wave:
 * four reads side by side cost the slowest of them, not the sum.
 *
 * `readMe`, `listOpenRequests` and `readInbox` are all `cache`d for the
 * request, and the pages ask the same questions (every page asks `/me`
 * through `requireOperator()`, Home and Bookings ask `/requests`, Home asks
 * for the inbox), so on those screens this reads what the page reads, once.
 *
 * The same rule as the badges holds for all of it: a failure costs its own
 * piece of chrome, never the page. The wrong failure is a blank page over a
 * field nobody could read.
 */
export async function chromeData(): Promise<ChromeData> {
  let token: string | null;
  try {
    token = await readSessionToken();
  } catch {
    return SIGNED_OUT;
  }
  if (!token) return SIGNED_OUT;

  const [me, requests, businessName, inbox] = await Promise.allSettled([
    readMe(token),
    listOpenRequests(token),
    readBusinessName(token),
    readInbox(token),
  ]);

  const account = me.status === "fulfilled" ? me.value.account : undefined;
  const unread =
    inbox.status === "fulfilled" && inbox.value !== null
      ? inbox.value.conversations
      : undefined;

  const canManage = me.status === "fulfilled" && me.value.canManage === true;
  return {
    badges: countBadges({
      account: account ? standingOf(account) : null,
      canManage,
      requests: requests.status === "fulfilled" ? requests.value : undefined,
    }),
    suspension: suspensionOf(account),
    businessName:
      businessName.status === "fulfilled" ? businessName.value : null,
    canManage,
    ...(unread !== undefined ? { unread } : {}),
  };
}
