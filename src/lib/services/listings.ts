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

/**
 * Every status this build can describe.
 *
 * **Not derived from the generated union, on purpose.** `not_selling` is real
 * on the server and is not yet in `contracts/operator-openapi.yaml` — the
 * change that adds it (yuvoy-api migration 0053) is announced on
 * yuvoy-operator#28 but is not on master, so the pinned contract still
 * declares six values. Deriving this list from the generated type would mean
 * the copy for it could not exist until the merge, and until then an operator
 * whose listings had stopped earning would be shown "this version of the
 * portal cannot describe this state".
 *
 * Nothing here depends on the value's TYPE, only on the string, so this is
 * safe in both directions: inert while the API never sends it, correct the
 * moment it does. What genuinely needs the merge is the narrowing in
 * `orderListings` — see the note there.
 */
export const LISTING_STATUSES = [
  "draft",
  "in_review",
  "live",
  "live_changes_in_review",
  "changes_rejected",
  "withdrawn",
  "not_selling",
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
  /**
   * Whether this state is waiting on the OPERATOR, rather than on us.
   *
   * Drives the accent chip. Asked here rather than by a screen comparing
   * `status` to a literal, because one of the two states that qualify —
   * `not_selling` — is not in the generated union yet, and a component
   * comparing against it is a type error rather than dead code. This keeps the
   * question where the answer already lives.
   */
  needsAnswer: boolean;
  /**
   * Whether the reason lives on the ACCOUNT, so Business is the way forward.
   *
   * True only for `not_selling`, whose four causes are deliberately not on the
   * listing object: they belong to the account, `GET /me` returns the blockers
   * that name them, and the Business screen already renders them. A screen
   * asks this rather than guessing which of the four it is.
   */
  accountGap: boolean;
}

/*
  THE DEMO'S WORDS — yuvoy-operator#44.

  "Three states — Live accepts bookings, Paused is operator-disabled, In review
  has been submitted and has no pause/resume button." `live` read "On sale",
  `withdrawn` "Off sale" and `in_review` "With us"; they now read as the
  product names them, and every body still says who has the listing next.

  `withdrawn` is the one whose MEANING changed, not only its word. Since
  D-032.4 (yuvoy-api#157) putting a listing back is the operator's own switch
  and is immediate, so "send a change to put it back in front of us" became
  false twice over: approving an edit never republished a withdrawn listing,
  and nothing waits on us any more.
*/
const STATUS: Record<ListingStatus, StatusCopy> = {
  draft: {
    label: "Draft",
    body: "Written, and sent to nobody. Send it to us when it is ready.",
    selling: false,
    canSubmit: true,
    needsAnswer: false,
    accountGap: false,
  },
  in_review: {
    label: "In review",
    body: "We are reading it. Nothing is on sale until it is approved.",
    selling: false,
    canSubmit: false,
    needsAnswer: false,
    accountGap: false,
  },
  live: {
    label: "Live",
    body: "Travellers can book this.",
    selling: true,
    canSubmit: true,
    needsAnswer: false,
    accountGap: false,
  },
  live_changes_in_review: {
    label: "Live · edit in review",
    /*
      The sentence the contract asks clients to say, because "the obvious
      assumption is the opposite": an edit under review does NOT take a live
      listing off sale, and travellers who already booked keep the price and
      terms they booked on.
    */
    body: "Still on sale on the old terms while we read your change. Anybody who already booked keeps what they booked on.",
    selling: true,
    canSubmit: false,
    needsAnswer: false,
    accountGap: false,
  },
  changes_rejected: {
    label: "We came back to you",
    body: "Read what we said, change it, and send it again.",
    selling: false,
    canSubmit: true,
    needsAnswer: true,
    accountGap: false,
  },
  withdrawn: {
    label: "Paused",
    body: "You paused it, so nobody new can book it. Resume it when you are ready. It goes straight back on sale.",
    selling: false,
    canSubmit: true,
    needsAnswer: false,
    accountGap: false,
  },
  /*
    Published, and earning nothing — yuvoy-operator#28, from yuvoy-api's
    migration 0053.

    The one status a client cannot infer from `publicationState`. The listing
    IS published and is still absent from every feed, absent from search and
    refusing checkout, because one of four things is true: the operator is not
    selling, a kill switch is engaged, the listing lost its price, or a
    credential their market and activity category require is missing,
    unverified or expired.

    **The reason is deliberately not on this object**, and this copy does not
    invent one. It belongs to the account, `GET /me` returns the blockers that
    name it, and the Business screen already renders them — so the row points
    there rather than guessing which of the four it is.

    **Per listing, never a banner.** Credential requirements resolve per
    activity category, so an operator can have one listing not selling because
    an instructor certificate lapsed while another stays live. A banner at the
    top of the screen would be wrong about both.

    Before 0053 a published listing genuinely sold whatever the operator's
    status said, so `live` was accurate. It no longer would be — and the
    fallback below, "this version of the portal cannot describe this state", is
    the wrong sentence to show somebody whose listings have stopped earning.
  */
  not_selling: {
    label: "Not selling",
    body: "Published, but not on sale. See what is outstanding on Business.",
    selling: false,
    /*
      They CAN still send an edit. Nothing about this state is about the
      listing's text — it is the account or the price — and refusing the edit
      would be a second, invented refusal on top of the real one.
    */
    canSubmit: true,
    needsAnswer: true,
    accountGap: true,
  },
};

/**
 * Whether a listing is a draft: edited step by step and sent with
 * `POST /experiences/{id}/submit`, rather than changed by a proposed revision.
 *
 * `publicationState` says what the listing IS; `status` folds in the latest
 * revision, so a first listing a reviewer sent back reads `changes_rejected`
 * there while being a draft again ("change it with `PATCH /experiences/{id}`
 * and send it with `POST /experiences/{id}/submit`"). The listing's screen
 * read the one and the edit screen the other, so its rows opened the revision
 * form, which has no category, place or landmark to fix (the audit before
 * release, O3). One rule now, for both. With no `publicationState` (an older
 * API), `status` says it, a sent-back one included.
 */
export function isDraft(listing: {
  publicationState?: string;
  status?: string;
  sentBack?: unknown;
}): boolean {
  if (listing.publicationState) return listing.publicationState === "draft";
  return (
    listing.status === "draft" ||
    (listing.status === "changes_rejected" && Boolean(listing.sentBack))
  );
}

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
    // No claim in either direction. A build that cannot name the state cannot
    // know whose move it is, and an accent chip would assert that it does.
    needsAnswer: false,
    accountGap: false,
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

/**
 * How badly each status needs the operator. Lower comes first.
 *
 * A lookup rather than a `switch`, because `not_selling` is not in the
 * generated union yet — see {@link LISTING_STATUSES} — and narrowing on a
 * value the pinned contract does not declare is a type error rather than dead
 * code. Keyed by string, it is inert until the API sends one and correct the
 * moment it does.
 */
const URGENCY: Record<string, number> = {
  /*
    Published, and earning nothing. Above `changes_rejected` deliberately: a
    listing that WAS selling and has stopped is costing the operator money
    right now, while a rejected revision is a listing that never went live.
    Both are their homework; only one has a meter running.

    Raised with the API on yuvoy-operator#28 rather than decided silently, so
    if the intended reading is different this moves rather than lingers.
  */
  not_selling: 0,
  changes_rejected: 1, // We came back to them.
  draft: 2, // They started and stopped.
  live: 3,
  live_changes_in_review: 3,
  in_review: 4, // With us; nothing for them to do.
};

/** Sorted so the ones needing the operator come first, then by title. */
export function orderListings(
  listings: readonly OperatorExperience[],
): OperatorExperience[] {
  // Withdrawn, and anything this build does not recognise, sort last.
  const urgency = (l: OperatorExperience) => URGENCY[l.status ?? ""] ?? 5;
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

/**
 * How a price is stated — yuvoy-operator#30 §1.
 *
 * `experiences.pricing_unit` has always existed and checkout has always
 * divided correctly for a group price. What was missing is anybody SAYING
 * which one applies: the column defaulted to `per_person`, so a listing nobody
 * was asked about was indistinguishable from a private charter deliberately
 * priced for the group.
 *
 * That mattered less when nothing displayed it. It matters now that the
 * traveller card and detail page render the basis next to the rupee figure
 * (yuvoy-app#20): a ₹12,000 charter for six would read "₹12,000 per person"
 * with our authority behind it. That is a consumer pricing misstatement, and
 * it is the class of claim this project removed a whole site over.
 *
 * ## Why the picker ships before the migration
 *
 * `pricingUnit` is already on the create body in the pinned contract, as
 * `enum: [per_person, per_group], default: per_person`. Migration 0056 removes
 * that default and records an absent value as *unstated*. A form that always
 * sends the operator's explicit choice is correct against BOTH versions —
 * today it overrides a default, afterwards it satisfies a requirement — so
 * nothing here has to change when the migration lands.
 *
 * **Neither option is preselected, and that is the whole point.** The API
 * deliberately treats absent and chosen differently, so shipping a default
 * would defeat the change it is built for. Same call the reel rights
 * attestation makes about consent: an unanswered question is refused, never
 * sent as a quiet assumption.
 */
export const PRICING_UNITS = [
  {
    value: "per_person",
    label: "Per person",
    hint: "Each traveller pays this.",
  },
  {
    value: "per_group",
    label: "For the group",
    hint: "One price for the whole booking, however many come.",
  },
] as const;

export type PricingUnit = (typeof PRICING_UNITS)[number]["value"];

/** The phrase to show beside a price, or null for a basis nobody has stated. */
export function describePricingUnit(unit: string | undefined): string | null {
  return PRICING_UNITS.find((u) => u.value === unit)?.label ?? null;
}

/**
 * What is still missing before a listing can be published — yuvoy-operator#30 §3.
 *
 * `publishBlockers` names the mandatory fields still empty, "in the same
 * spelling the revision body uses", so a row can say WHICH rather than a
 * generic "cannot publish". Empty means nothing is outstanding.
 *
 * Named here rather than rendered raw for one reason: `unitPricePaise` and
 * `activityType` are wire spellings, and an operator reading "unitPricePaise"
 * on their own listing learns nothing. An unrecognised blocker falls back to
 * the key itself rather than being dropped — a blocker this build cannot name
 * is still a blocker, and hiding it would make the row claim the listing is
 * ready when the API will refuse it.
 */
const BLOCKER_LABELS: Record<string, string> = {
  summary: "a short summary",
  description: "a description",
  activityType: "what kind of activity it is",
  destination: "where it runs",
  unitPricePaise: "a price",
  /*
    The one that is not simply "empty". The column is NOT NULL, so the value
    alone cannot say whether anybody chose it — the database records that
    separately, and an unstated basis blocks publication rather than printing a
    guessed phrase beside the price. Which is the same defect, one layer down,
    that yuvoy-app#20 §1 fixed on the traveller's card.
  */
  pricingUnit: "whether that price is per person or for the group",
  meetingPoint: "where to meet",
  durationMinutes: "how long it takes",
  maxPartySize: "the most people per booking",
  title: "a title",
  category: "a category",
};

export function describeBlockers(
  blockers: readonly string[] | undefined,
): string[] {
  return (blockers ?? []).map((key) => BLOCKER_LABELS[key] ?? key);
}

/**
 * Why an operator is pausing their own listing — yuvoy-operator#30 §6, #44.
 *
 * The thing they could not do: only an admin could take a listing off sale, so
 * an operator whose boat was out of the water for a month had to ask somebody
 * at Yuvoy — a queue with a portal in front of it.
 *
 * A closed set in the contract — the same five on `pause` as on `withdraw`,
 * which is the same handler under its older name — so it is rendered rather
 * than paraphrased.
 */
export const PAUSE_REASONS = [
  { code: "seasonal_close", label: "Closed for the season" },
  { code: "not_running", label: "Not running this at the moment" },
  { code: "price_wrong", label: "The price is wrong" },
  { code: "details_wrong", label: "Something in the details is wrong" },
  { code: "other", label: "Something else" },
] as const;

export type PauseReason = (typeof PAUSE_REASONS)[number]["code"];
