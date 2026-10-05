import { formatPaise } from "@/lib/format/money";
import { dedash } from "@/lib/format/dedash";
import {
  NO_DATES_BADGE,
  listingLabel,
  liveWithNothingToSell,
} from "@/lib/services/home";
import {
  describeBlockers,
  describePricingUnit,
  describeRejection,
  isDraft,
} from "@/lib/services/listings";

/**
 * The business profile's own rules — yuvoy-operator#58 items 2, 3, 5 and 11.
 *
 * ## Why the numbers are read and not counted
 *
 * `stats` is "the three numbers at the top of your profile. Always present,
 * zeroes included." `stats.listings` in particular "counts listings a traveller
 * can buy now" — a portal counting `live` rows would miss
 * `live_changes_in_review`, which is still selling, and would answer a
 * different question the day another state joins that set.
 */

export const TAB_VALUES = ["listings", "reels", "reviews"] as const;
export type Tab = (typeof TAB_VALUES)[number];

/** Which tab a URL asks for. Anything else is the default rather than a 404. */
export function readTab(raw: string | undefined): Tab {
  return (TAB_VALUES as readonly string[]).includes(raw ?? "")
    ? (raw as Tab)
    : "listings";
}

export const TAB_LABEL: Record<Tab, string> = {
  listings: "Listings",
  reels: "Reels",
  reviews: "Reviews",
};

/**
 * The stand-in for a business with no name on file. It is ours, so a heading
 * that sets the business's own name in the host's voice sets this in ours.
 */
export const UNNAMED_BUSINESS = "Your business";

/**
 * What the profile is called.
 *
 * `displayName`, then `legalName`, then a stand-in. Never blank: a profile with
 * no heading reads as a page that failed to load, and "Your business" is at
 * least true.
 */
export function businessName(
  profile: {
    displayName?: string;
    legalName?: string;
  } | null,
): string {
  const display = (profile?.displayName ?? "").trim();
  if (display) return display;
  const legal = (profile?.legalName ?? "").trim();
  return legal || UNNAMED_BUSINESS;
}

/** "since 2014 · English, Hindi", or nothing when neither half is there. */
export function sinceLine(
  operatingSince: number | string | undefined,
  languages: readonly string[] | undefined,
): string | null {
  const parts: string[] = [];
  if (operatingSince) parts.push(`since ${operatingSince}`);
  const spoken = (languages ?? []).filter((l) => l.trim() !== "");
  if (spoken.length > 0) parts.push(spoken.join(", "));
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * The third number on the profile: "4.8 ★" over "37 reviews", or "0" over
 * "Reviews" when there are none. `null` when the response did not say.
 *
 * yuvoy-operator#86 s9: "'No reviews yet' sits where a number belongs ...
 * Three numbers in a row set an expectation that all three are numbers. One
 * is a sentence, so the row reads as broken. Show '0' with the word Reviews
 * under it, exactly like the others."
 *
 * The 0 is a COUNT of reviews, never a score: "0.0 ★" would tell an operator
 * their travellers scored them nothing, which is a different and much worse
 * claim, so an average is only ever drawn when there is one. And a rating the
 * response did not carry at all is not drawn as a 0 either: that would be a
 * number nobody measured.
 */
export function ratingLine(
  rating:
    | {
        average?: number | null;
        count?: number;
      }
    | undefined,
): { value: string; label: string } | null {
  const count = rating?.count;
  if (!Number.isInteger(count) || (count as number) < 0) return null;
  const reviews = count === 1 ? "1 review" : `${count} reviews`;
  const average = rating?.average;
  if (typeof average === "number" && (count as number) > 0) {
    return { value: `${average} ★`, label: reviews };
  }
  return { value: String(count), label: count === 1 ? "Review" : "Reviews" };
}

/**
 * The order the Listings grid uses — yuvoy-operator#58 item 3.
 *
 * Not the order Home uses (#56 item 5), and the difference is what each screen
 * is FOR. Home is the working day, so what is selling comes first. This is
 * where listings are made and mended, so what is waiting on the operator comes
 * first and what is quietly selling comes last.
 */
export function profileGroup(listing: {
  status?: string;
  sentBack?: unknown;
}): number {
  switch (listing.status) {
    case "changes_rejected":
      return 1;
    case "in_review":
    case "live_changes_in_review":
      return 2;
    case "draft":
      return 3;
    case "live":
      return 4;
    case "not_selling":
    case "withdrawn":
      return 5;
    default:
      return 6;
  }
}

export function orderForProfile<T extends { status?: string; title?: string }>(
  listings: readonly T[],
): T[] {
  return [...listings].sort((a, b) => {
    const group = profileGroup(a) - profileGroup(b);
    if (group !== 0) return group;
    return (a.title ?? "").localeCompare(b.title ?? "");
  });
}

/** What a listing's tile reads from it. Every field as `listListings` carries it. */
export interface TileListing {
  status?: string;
  sentBack?: unknown;
  bookableDatesNext30Days?: number;
  publicationState?: string;
  publishBlockers?: string[];
  sellable?: boolean;
  unitPricePaise?: number;
  pricingUnit?: string;
}

export interface TileFacts {
  /** The state, on every tile: "Live", "Draft", "Sent back", "Paused". */
  state: string;
  /** Whether the state waits on the operator, which is what the eye finds. */
  attention: boolean;
  /** The one line under the title, or nothing to say. */
  line: string | null;
}

/**
 * What a listing's tile on Business says (operator A, approved 3 Oct 2026:
 * "Listings come first, each with its state, and a draft says in words what is
 * still missing").
 *
 * **Every tile has its state now, Live included.** #58 item 3 drew no badge
 * on a live tile, so that the tiles needing something did not disappear into
 * the pattern. That reason is kept another way: only a state that waits on the
 * operator is `attention` (sent back, an edit declined, a draft, not selling,
 * live with nothing to sell), and the rest are drawn quietly.
 *
 * **The line:**
 *   - sent back: why, in the closed set's words or the reviewer's own;
 *   - a draft: "Still missing: ...", the sentence every other screen uses for
 *     `publishBlockers`, all of them, or "Ready to send for review" when the
 *     API says nothing is outstanding. A list the API did not send is not an
 *     empty one, so it claims neither;
 *   - anything that sells or sold: its price, with its basis only when
 *     somebody stated it (an unstated basis is a blocker, and printing "per
 *     person" beside it is the guessed phrase the contract forbids);
 *   - in review: nothing. It is with us, and the state says so.
 */
export function tileFacts(listing: TileListing): TileFacts {
  const noDates = liveWithNothingToSell(listing);
  const status = listing.status ?? "";
  const state = noDates ? NO_DATES_BADGE : listingLabel(listing);
  const attention =
    noDates ||
    status === "changes_rejected" ||
    status === "not_selling" ||
    isDraft(listing);
  return { state, attention, line: tileLine(listing) };
}

function tileLine(listing: TileListing): string | null {
  if (listing.sentBack) return sentBackReason(listing.sentBack);
  if (isDraft(listing)) {
    const blockers = listing.publishBlockers;
    if (blockers === undefined) {
      // An older API: `sellable` is the one thing it can still say.
      return listing.sellable === false ? "Still missing: a price" : null;
    }
    return blockers.length > 0
      ? `Still missing: ${describeBlockers(blockers).join(", ")}`
      : "Ready to send for review";
  }
  if (listing.status === "in_review") return null;
  return priceOf(listing);
}

/** "₹4,500 per person", "₹12,000 for the group", or the figure alone. */
function priceOf(listing: TileListing): string | null {
  const paise = listing.unitPricePaise;
  if (paise === undefined) return null;
  const stated = !(listing.publishBlockers ?? []).includes("pricingUnit");
  const unit = stated ? describePricingUnit(listing.pricingUnit) : null;
  return unit
    ? `${formatPaise(paise)} ${unit.toLowerCase()}`
    : formatPaise(paise);
}

/**
 * Why a reviewer sent it back: the closed set's sentence, else the
 * reviewer's own note, long dashes out (the reviewer's text comes from
 * another team's database). Nothing when there is neither: the listing's own
 * screen then says to call us, which a tile has no room to.
 */
function sentBackReason(sentBack: unknown): string | null {
  if (typeof sentBack !== "object" || sentBack === null) return null;
  const { rejectionCode, rejectionNote } = sentBack as {
    rejectionCode?: unknown;
    rejectionNote?: unknown;
  };
  const reason =
    typeof rejectionCode === "string" ? describeRejection(rejectionCode) : null;
  if (reason) return reason;
  const note =
    typeof rejectionNote === "string" ? dedash(rejectionNote.trim()) : "";
  return note || null;
}

/**
 * What a media tile's badge says, by `situation` — item 5.
 *
 * This replaces a badge derived from `state`, and the contract says why the
 * server computes `situation` at all: "deriving the situation from two
 * enumerations client side gets it wrong in ways nobody notices for a month."
 *
 * An absent or unknown value gets NO badge. A wrong badge on a reel is an
 * operator waiting for something that already happened, or chasing something
 * that never will.
 */
const SITUATION: Record<string, string> = {
  processing: "Processing",
  needs_rights: "Needs your rights",
  in_review: "In review",
  changes_needed: "Changes needed",
  live: "Live",
  waiting_on_listing: "Waiting on the listing",
  listing_withdrawn: "Listing paused",
  not_attached: "Not on a listing",
  withdrawn: "Taken down",
  failed: "Failed",
};

export function situationBadge(situation: string | undefined): string | null {
  return SITUATION[situation ?? ""] ?? null;
}

/**
 * Reels in the order they need answering: what was declined, then what is
 * waiting on the operator, then everything else as the API sent it.
 */
export function orderMedia<T extends { situation?: string }>(
  items: readonly T[],
): T[] {
  const rank = (situation: string | undefined) =>
    situation === "changes_needed" ? 0 : situation === "needs_rights" ? 1 : 2;
  return [...items].sort((a, b) => rank(a.situation) - rank(b.situation));
}

/* ------------------------------------------------------------- reviews -- */

export const TAG_ORDER = [
  "guide",
  "safety",
  "value",
  "organisation",
  "punctuality",
  "equipment",
] as const;

export const TAG_LABEL: Record<string, string> = {
  guide: "Guide",
  safety: "Safety",
  value: "Value",
  organisation: "Organisation",
  punctuality: "Punctuality",
  equipment: "Equipment",
};

/**
 * "Guide 21 · Safety 18 · Value 9" — the tags travellers actually chose.
 *
 * Highest first, and ties in the guide-safety-value-organisation-punctuality-
 * equipment order the issue sets, so two businesses with the same counts read
 * the same way. A tag nobody chose is left out rather than shown as zero: a
 * list of zeroes says something about the business that nobody said.
 */
export function tagLine(
  tags: Record<string, number> | undefined,
): string | null {
  const chosen = TAG_ORDER.map((key, index) => ({
    key,
    index,
    count: tags?.[key] ?? 0,
  }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index);
  if (chosen.length === 0) return null;
  return chosen.map((t) => `${TAG_LABEL[t.key]} ${t.count}`).join(" · ");
}

/** "4.8 ★ · 37 reviews", or the sentence for a business with none. */
export function reviewSummaryLine(summary: {
  averageRating?: number | null;
  count?: number;
}): string {
  const count = summary.count ?? 0;
  if (count === 0) return "No reviews yet";
  const reviews = count === 1 ? "1 review" : `${count} reviews`;
  return `${summary.averageRating} ★ · ${reviews}`;
}

/**
 * Who left a review.
 *
 * "A traveller" when the API sends null, and a FIRST NAME when it does not
 * (D-018). Never a surname and never a contact detail: a review is published to
 * whoever opens the operator's page.
 */
export function reviewerName(travellerName: string | null | undefined): string {
  const name = (travellerName ?? "").trim();
  return name === "" ? "A traveller" : name;
}
