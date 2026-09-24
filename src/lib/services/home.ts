import { marketDayOf } from "@/lib/day/calendar";
import { describeStatus } from "./listings";

/**
 * A listing at a glance: where it sits in the list, what its badge says, the
 * picture on its tile, and the fortnight of departures its hub draws
 * (yuvoy-operator#56 items 3 to 5). Home's own blocks live in `lib/home`.
 */

export interface ListingLike {
  id?: string;
  title?: string;
  status?: string;
  /**
   * PRESENCE is the signal, not a boolean.
   *
   * The contract sends an object — "present while a reviewer has sent this
   * listing back to you", carrying the code, the note and when — so the field
   * is typed as unknown here and read with `Boolean`. Typing it as a boolean
   * compiled and would have been `true` for every listing carrying the object,
   * which is the same answer by luck rather than by reading.
   */
  sentBack?: unknown;
  /**
   * Market days in the next 30 a traveller could book right now, by the same
   * rules as checkout (yuvoy-api#205). Absent on an older API, which must read
   * as "we cannot say", never as zero.
   */
  bookableDatesNext30Days?: number;
}

/**
 * Live, and nothing a traveller can book (yuvoy-operator#95 item 3).
 *
 * "A `published` listing reading 0 is on the traveller app and sells
 * nothing." Only `live` and `live_changes_in_review` are on the traveller
 * app: `not_selling` also reads 0, for a reason on the account, and saying
 * "live" about it would be the wrong fact. Absent is never zero.
 */
export function liveWithNothingToSell(listing: ListingLike): boolean {
  const onTheApp =
    listing.status === "live" || listing.status === "live_changes_in_review";
  return onTheApp && listing.bookableDatesNext30Days === 0;
}

/** The tile's words for it: short, because a tile is a third of a phone. */
export const NO_DATES_BADGE = "No dates in 30 days";

/** Whether a reviewer has sent this listing back. See `ListingLike.sentBack`. */
function isSentBack(listing: ListingLike): boolean {
  return Boolean(listing.sentBack);
}

/**
 * Which group a listing sits in, and the order is the operator's attention
 * rather than the alphabet.
 *
 *   1. anything that is SELLING or could be, including a published listing
 *      whose edit was declined: it still sells, so it is not a problem;
 *   2. anything waiting on THEM: a draft, or an edit we sent back;
 *   3. anything waiting on US;
 *   4. a state this build has never heard of.
 *
 * `changes_rejected` splits across 1 and 2 on `sentBack`, which is the whole
 * subtlety: the same status means "your edit was declined and the live version
 * still sells" and "this is back with you", and putting both in one group would
 * put a working listing in the pile of things to fix.
 */
export function listingGroup(listing: ListingLike): number {
  const status = listing.status ?? "";
  switch (status) {
    case "live":
    case "live_changes_in_review":
    case "not_selling":
    case "withdrawn":
      return 1;
    case "changes_rejected":
      return isSentBack(listing) ? 2 : 1;
    case "draft":
      return 2;
    case "in_review":
      return 3;
    default:
      return 4;
  }
}

/** Groups in that order, then title A to Z inside a group. */
export function orderListings<T extends ListingLike>(
  listings: readonly T[],
): T[] {
  return [...listings].sort((a, b) => {
    const group = listingGroup(a) - listingGroup(b);
    if (group !== 0) return group;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });
}

/**
 * The label on a listing's badge.
 *
 * `describeStatus` is the one shared map, and #58 reuses it. The one thing it
 * cannot know is `sentBack`, which splits `changes_rejected` into two different
 * sentences about whose move it is.
 */
export function listingLabel(listing: ListingLike): string {
  if (listing.status === "changes_rejected") {
    return isSentBack(listing) ? "Sent back" : "Changes declined";
  }
  return describeStatus(listing.status).label;
}

export interface MediaLike {
  /**
   * NESTED, because `OperatorMedia` nests it: "the listing this media belongs
   * to, chosen at upload since D-031 C5". Read from the wrong level this would
   * be `undefined` on every row and every tile would come back blank, which
   * looks like a business with no photographs rather than a bug.
   */
  listing?: { experienceId?: string };
  posterUrl?: string;
  situation?: string;
}

/**
 * The picture for a listing's tile.
 *
 * `OperatorMedia` has no hero or gallery field yet — the issue lists that as
 * waiting on the API — so the rule is the issue's: the listing's own items that
 * have a poster, preferring one that is `live`, otherwise the first, which is
 * the newest because the API orders it that way.
 *
 * `null` is a blank tile rather than a placeholder photograph of somebody
 * else's boat. One helper, because #58 shows the same tile.
 */
export function posterFor(
  media: readonly MediaLike[],
  listingId: string,
): string | null {
  const mine = media.filter(
    (m) => m.listing?.experienceId === listingId && m.posterUrl,
  );
  const live = mine.find((m) => m.situation === "live");
  return (live ?? mine[0])?.posterUrl ?? null;
}

/** Only the departures on market days up to today + 13, soonest first. */
export function withinFortnight<
  T extends { startsAt?: string; timezone?: string },
>(rows: readonly T[], today: string, last: string): T[] {
  return rows.filter((row) => {
    const day = marketDayOf(row.startsAt ?? "", row.timezone ?? "Asia/Kolkata");
    return day !== null && day >= today && day <= last;
  });
}
