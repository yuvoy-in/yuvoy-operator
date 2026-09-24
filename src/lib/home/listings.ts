import type { components } from "@/lib/api/schema.gen";
import { count } from "./words";

type OperatorExperience = components["schemas"]["OperatorExperience"];

/**
 * A listing, as Home reads it from `GET /experiences` (yuvoy-operator#96).
 *
 * Home no longer lists listings; it counts them, adds up what is off sale on
 * them, and names the live ones that have nothing to sell. So this carries
 * exactly those fields and nothing a row would draw.
 *
 * Every count is kept as an ABSENCE when the API did not send a whole number:
 * "Always present, 0 when none" is what the pinned contract promises, and
 * required-in-a-contract is a promise about master, not about the deployed
 * API. An absent `bookableDatesNext30Days` read as 0 would tell an operator
 * whose listing sells every day that it sells nothing.
 */
export interface HomeListing {
  id: string;
  title: string;
  status?: string;
  /** `draft`, `in_review`, `published`, `withdrawn`. */
  publicationState?: string;
  /** Present while a reviewer has sent a never-published listing back. */
  sentBack: boolean;
  bookableDatesNext30Days?: number;
  departuresNotOnSale?: number;
  departuresGoingOffSaleSoon?: number;
  upcomingDepartures?: number;
}

const whole = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;

/** One listing off the wire, or `null` for a row with no id to point at. */
export function toHomeListing(raw: OperatorExperience): HomeListing | null {
  if (!raw.id) return null;
  const listing: HomeListing = {
    id: raw.id,
    title: raw.title?.trim() || "Untitled listing",
    sentBack: Boolean(raw.sentBack),
  };
  if (raw.status) listing.status = raw.status;
  if (raw.publicationState) listing.publicationState = raw.publicationState;
  const fields = [
    "bookableDatesNext30Days",
    "departuresNotOnSale",
    "departuresGoingOffSaleSoon",
    "upcomingDepartures",
  ] as const;
  for (const field of fields) {
    const value = whole(raw[field]);
    if (value !== undefined) listing[field] = value;
  }
  return listing;
}

/**
 * On the traveller app right now.
 *
 * `live`, live with an edit in review, and a published listing whose EDIT was
 * declined: that one still sells (it carries no `sentBack`; see
 * `neverPublished`), and the glance line below has always counted it as live.
 * Leaving it out had Home say "Not selling: no listing is live" to a business
 * whose one listing was on sale. With no `status` at all, the publication
 * state says it.
 */
export function isLive(listing: {
  status?: string;
  publicationState?: string;
  sentBack?: boolean;
}): boolean {
  switch (listing.status) {
    case "live":
    case "live_changes_in_review":
      return true;
    case "changes_rejected":
      return !listing.sentBack;
    case undefined:
      return listing.publicationState === "published";
    default:
      return false;
  }
}

/** Every status this build can place, live or not. */
const KNOWN_STATUSES = new Set([
  "live",
  "live_changes_in_review",
  "changes_rejected",
  "withdrawn",
  "not_selling",
  "in_review",
  "draft",
]);

/**
 * Whether this build can say if the listing sells at all.
 *
 * A status it has never heard of (the set grows on the server), or none and no
 * publication state either, is not a listing that does not sell. It is one
 * nobody here can place, and "Not selling" about it would be a guess.
 */
export function saleKnown(
  listing: Pick<HomeListing, "status" | "publicationState">,
): boolean {
  if (listing.status !== undefined) return KNOWN_STATUSES.has(listing.status);
  return listing.publicationState !== undefined;
}

/**
 * A listing that has never been on sale: nobody could have booked it.
 *
 * `publicationState` answers it when the API sends it: a `draft` or a first
 * submission still `in_review` was never published. Without it, the status
 * does: a draft, one in its first review, or one sent back before it was
 * ever on sale. A published listing whose EDIT was declined also reads
 * `changes_rejected`, but carries no `sentBack` and still sells.
 */
export function neverPublished(
  listing: Pick<HomeListing, "status" | "publicationState" | "sentBack">,
): boolean {
  if (listing.publicationState) {
    return (
      listing.publicationState === "draft" ||
      listing.publicationState === "in_review"
    );
  }
  return (
    listing.status === "draft" ||
    listing.status === "in_review" ||
    (listing.status === "changes_rejected" && listing.sentBack)
  );
}

/**
 * Live, and nothing a traveller could book in the next 30 days
 * (yuvoy-operator#95 item 3). "A `published` listing reading 0 is on the
 * traveller app and sells nothing." Absent is never zero.
 */
export function liveWithNoDates(listing: HomeListing): boolean {
  return isLive(listing) && listing.bookableDatesNext30Days === 0;
}

/**
 * "3 live · 1 paused · 3 drafts": every listing, counted by where it is, for
 * the line on Home that opens Business (yuvoy-operator#96 block 5).
 *
 * A published listing whose edit was declined still sells, so it counts as
 * live; a first listing sent back is a draft again. A state this build has
 * never heard of is counted as "other" rather than dropped, so the parts
 * always add up to the listings there are.
 */
export function listingsGlance(listings: readonly HomeListing[]): string {
  if (listings.length === 0) return "No listings yet";
  let live = 0;
  let paused = 0;
  let notSelling = 0;
  let inReview = 0;
  let drafts = 0;
  let other = 0;
  for (const listing of listings) {
    switch (listing.status) {
      case "live":
      case "live_changes_in_review":
        live += 1;
        break;
      case "changes_rejected":
        if (listing.sentBack) drafts += 1;
        else live += 1;
        break;
      case "withdrawn":
        paused += 1;
        break;
      case "not_selling":
        notSelling += 1;
        break;
      case "in_review":
        inReview += 1;
        break;
      case "draft":
        drafts += 1;
        break;
      default:
        other += 1;
    }
  }
  const parts: string[] = [];
  if (live > 0) parts.push(`${live} live`);
  if (paused > 0) parts.push(`${paused} paused`);
  if (notSelling > 0) parts.push(`${notSelling} not selling`);
  if (inReview > 0) parts.push(`${inReview} in review`);
  if (drafts > 0) parts.push(count(drafts, "draft", "drafts"));
  if (other > 0) parts.push(`${other} other`);
  return parts.join(" · ");
}
