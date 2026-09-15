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
  return legal || "Your business";
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

/** "4.8 ★" and "Rating (37)", or the sentence that stands in for both. */
export function ratingLine(
  rating:
    | {
        average?: number | null;
        count?: number;
      }
    | undefined,
): { value: string; label: string } {
  const average = rating?.average;
  if (average === null || average === undefined) {
    /*
      "No reviews yet" rather than "0.0 ★". A zero average is a rating nobody
      gave, and printing it as one tells an operator their travellers scored
      them nothing.
    */
    return { value: "No reviews yet", label: "" };
  }
  return { value: `${average} ★`, label: `Rating (${rating?.count ?? 0})` };
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
