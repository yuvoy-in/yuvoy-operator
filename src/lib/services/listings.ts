import type { components } from "@/lib/api/schema.gen";

export type OperatorExperience = components["schemas"]["OperatorExperience"];

/**
 * What an operator sells, and where each of those things has got to.
 *
 * ## `status` is the field to render, and nothing here recombines it
 *
 * The contract is explicit: it is "derived from the publication state and the
 * latest revision **together**, because neither answers 'where is this' alone
 * — a published listing with a submitted edit is live AND in review, and a
 * draft whose revision was rejected is 'we came back to you' rather than
 * 'draft'."
 *
 * So `publicationState` and `review.state` are never combined by this portal.
 * A screen that rebuilt the answer from the parts would disagree with the
 * admin console about the same listing, and the operator would be the one who
 * found out.
 *
 * ## Nothing here is a success toast
 *
 * "Neither a listing nor a clip goes live because the operator said so." An
 * operator who submits and sees "Saved" will assume they are selling, and will
 * ring us on the day nobody books. Every state below says who has it.
 */

export const LISTING_STATUSES = [
  "draft",
  "in_review",
  "live",
  "live_changes_in_review",
  "changes_rejected",
  "withdrawn",
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export interface StatusCopy {
  /** The one word on the chip. */
  label: string;
  /** Who has it, and what happens next. Never "saved". */
  body: string;
  /** Whether this listing is on sale to travellers right now. */
  selling: boolean;
  /** Whether the operator can send it (or an edit) for review from here. */
  canSubmit: boolean;
}

const STATUS: Record<ListingStatus, StatusCopy> = {
  draft: {
    label: "Draft",
    body: "Written, and sent to nobody. Send it to us when it is ready.",
    selling: false,
    canSubmit: true,
  },
  in_review: {
    label: "With us",
    body: "We are reading it. Nothing is on sale until it is approved.",
    selling: false,
    canSubmit: false,
  },
  live: {
    label: "On sale",
    body: "Travellers can book this.",
    selling: true,
    canSubmit: true,
  },
  live_changes_in_review: {
    label: "On sale · edit with us",
    /*
      The sentence the contract asks clients to say, because "the obvious
      assumption is the opposite": an edit under review does NOT take a live
      listing off sale, and travellers who already booked keep the price and
      terms they booked on.
    */
    body: "Still on sale on the old terms while we read your change. Anybody who already booked keeps what they booked on.",
    selling: true,
    canSubmit: false,
  },
  changes_rejected: {
    label: "We came back to you",
    body: "Read what we said, change it, and send it again.",
    selling: false,
    canSubmit: true,
  },
  withdrawn: {
    label: "Off sale",
    body: "Taken off sale. Send a change to put it back in front of us.",
    selling: false,
    canSubmit: true,
  },
};

/**
 * The copy for a status, or an honest shrug for one this build has not met.
 *
 * An unknown status is shown as itself with no claim attached — the same rule
 * an unknown role follows on the team screen. Telling an operator a listing is
 * on sale when this build cannot tell is the one direction to avoid.
 */
export function describeStatus(status: string | undefined): StatusCopy {
  const known = (LISTING_STATUSES as readonly string[]).includes(status ?? "");
  if (known) return STATUS[status as ListingStatus];
  return {
    label: status ?? "Unknown",
    body: "This version of the portal cannot describe this state. Ask us before you rely on it.",
    selling: false,
    canSubmit: false,
  };
}

/**
 * Why we came back, in the operator's words.
 *
 * A closed set in the contract "precisely so you can render them rather than
 * paraphrase". An unknown code falls back to the API's own note rather than to
 * a guess — and if there is no note either, it says so instead of inventing a
 * reason.
 */
const REJECTION: Record<string, string> = {
  unclear_description: "The description was not clear enough to sell from.",
  missing_requirements:
    "It does not say what a traveller needs to bring or be able to do.",
  unsafe_claim: "Something in it claims more safety than we can stand behind.",
  price_mismatch: "The price does not match what you told us elsewhere.",
  meeting_point_unclear:
    "A traveller could not find the meeting point from this.",
  media_rights_unclear:
    "We could not confirm who owns the footage or photographs.",
  needs_conversation:
    "We would rather talk this one through than write it down.",
};

export function describeRejection(code?: string): string | null {
  if (!code) return null;
  return REJECTION[code] ?? null;
}

/** Sorted so the ones needing the operator come first, then by title. */
export function orderListings(
  listings: readonly OperatorExperience[],
): OperatorExperience[] {
  const urgency = (l: OperatorExperience) => {
    switch (l.status) {
      case "changes_rejected":
        return 0; // We are waiting on them.
      case "draft":
        return 1; // They started and stopped.
      case "live":
      case "live_changes_in_review":
        return 2;
      case "in_review":
        return 3; // With us; nothing for them to do.
      default:
        return 4; // Withdrawn, and anything unrecognised.
    }
  };
  return [...listings].sort((a, b) => {
    const d = urgency(a) - urgency(b);
    return d !== 0 ? d : (a.title ?? "").localeCompare(b.title ?? "", "en");
  });
}

/**
 * A listing that is on sale with no footage behind it.
 *
 * This is one half of the question the two screens exist to answer from both
 * directions — "this activity has no video" and "this clip is attached to
 * nothing" — and both are answered from ONE field: `listing` on a media item.
 *
 * Counted rather than guessed: a listing is short of footage only when no
 * media row names it. An operator with no clips at all sees every live listing
 * here, which is correct and is the state every operator starts in.
 */
export function listingsWithoutFootage(
  listings: readonly OperatorExperience[],
  attachedExperienceIds: ReadonlySet<string>,
): OperatorExperience[] {
  return listings.filter(
    (l) =>
      l.id !== undefined &&
      describeStatus(l.status).selling &&
      !attachedExperienceIds.has(l.id),
  );
}
