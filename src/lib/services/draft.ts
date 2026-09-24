import { formatPaise } from "@/lib/format/money";
import { describeBlockers } from "./listings";
import { stepOwning, type Step } from "./builder";

/**
 * A draft listing read back as it stands — yuvoy-operator#85 s10.
 *
 * ## Why the screen shows the listing rather than a list of holes
 *
 * "Still missing: a short summary, a price, where to meet" was the whole of
 * what a draft said about itself. It names what is absent and nothing that is
 * there, so an operator cannot see what they have written, what it will cost,
 * or what a traveller will meet. The screen draws the listing now, and marks
 * each missing field where that field belongs.
 *
 * ## The API's list is the truth about what is missing
 *
 * `publishBlockers` "is what the listing is still missing before it can be
 * published", and a field on it is treated as empty whatever the row holds.
 * That matters for one field in particular: `pricingUnit` is NOT NULL, "so the
 * value alone cannot tell the two apart" between a basis somebody chose and a
 * default nobody ever stated. The blocker is the answer; the column is not.
 *
 * A blocker this build has never heard of still has to appear, or the count on
 * the send button would disagree with the screen under it. Anything with no
 * row of its own is gathered at the end, under the API's own words for it.
 */

export interface DraftField {
  /** The API's own field name, the spelling `publishBlockers` uses. */
  key: string;
  /** What the operator calls it, short and in sentence case. */
  label: string;
  /** What the listing says now. `null` when it says nothing. */
  value: string | null;
  /** The builder step that answers it, or `null` for a field we do not know. */
  step: Step | null;
  /** Whether the API says this one stops the listing being published. */
  missing: boolean;
}

export interface DraftSection {
  /** The `aria-labelledby` id of its heading. Unique on the screen. */
  id: string;
  heading: string;
  fields: DraftField[];
}

/** What the listing carries, as much of it as this screen reads. */
export interface DraftListing {
  title?: string;
  summary?: string;
  description?: string;
  category?: string;
  activityType?: string;
  activityTypeLabel?: string;
  destination?: string;
  unitPricePaise?: number | null;
  pricingUnit?: string;
  durationMinutes?: number;
  maxPartySize?: number;
  meetingPoint?: string;
  meetingLandmark?: string;
  publishBlockers?: string[];
}

export interface DraftContext {
  /** How many photographs and clips are on it. */
  mediaCount: number;
  /** The words for the codes, from the vocabulary. Falls back to the code. */
  categoryLabel?: string;
  destinationLabel?: string;
}

/** A value worth printing, or nothing. Trimmed, because "  " says nothing. */
function said(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  return text === "" ? null : text;
}

function priceLine(paise: number | null | undefined): string | null {
  return typeof paise === "number" && Number.isFinite(paise)
    ? formatPaise(paise)
    : null;
}

const PRICING_UNIT: Record<string, string> = {
  per_person: "Per person",
  per_group: "For the group",
};

/**
 * The listing as it stands, grouped the way it is built: what it says, what it
 * costs, where it meets, and what it will look like.
 */
export function draftSections(
  listing: DraftListing,
  context: DraftContext,
): DraftSection[] {
  const blockers = listing.publishBlockers ?? [];
  const blocked = new Set(blockers);

  /*
    A blocked field is drawn as empty whatever it holds. `pricingUnit` is the
    one where those differ, and printing "Per person" beside a basis nobody
    stated is exactly the guessed phrase the contract asks clients not to
    print.
  */
  const field = (
    key: string,
    label: string,
    value: string | null,
  ): DraftField => ({
    key,
    label,
    value: blocked.has(key) ? null : value,
    step: stepOwning(key),
    missing: blocked.has(key),
  });

  const sections: DraftSection[] = [
    {
      id: "draft-says",
      heading: "What it says",
      fields: [
        field("title", "Name", said(listing.title)),
        field("category", "Category", said(context.categoryLabel)),
        field(
          "activityType",
          "Activity",
          said(listing.activityTypeLabel) ?? said(listing.activityType),
        ),
        field("destination", "Where it runs", said(context.destinationLabel)),
        field("summary", "One line about it", said(listing.summary)),
        field(
          "description",
          "What happens on the day",
          said(listing.description),
        ),
      ],
    },
    {
      id: "draft-costs",
      heading: "What it costs",
      fields: [
        field("unitPricePaise", "Price", priceLine(listing.unitPricePaise)),
        field(
          "pricingUnit",
          "That price is",
          PRICING_UNIT[listing.pricingUnit ?? ""] ?? null,
        ),
        field(
          "durationMinutes",
          "How long",
          listing.durationMinutes ? `${listing.durationMinutes} minutes` : null,
        ),
        field(
          "maxPartySize",
          "Most people per booking",
          listing.maxPartySize ? String(listing.maxPartySize) : null,
        ),
      ],
    },
    {
      id: "draft-meets",
      heading: "Where it meets",
      fields: [
        field("meetingPoint", "Where to meet", said(listing.meetingPoint)),
        field(
          "meetingLandmark",
          "What to look for",
          said(listing.meetingLandmark),
        ),
      ],
    },
    {
      id: "draft-looks",
      heading: "How it will look",
      fields: [
        /*
          Never a blocker, and said anyway: a listing with nothing on it is a
          blank card in the traveller app, which is the kind of thing an
          operator only discovers once it is live.
        */
        field(
          "media",
          "Photographs and clips",
          context.mediaCount > 0
            ? `${context.mediaCount} on it`
            : "Nothing on it yet. It would show as a blank card.",
        ),
      ],
    },
  ];

  /*
    Anything the API named that has no row above. A newer contract can add a
    mandatory field this build has never rendered, and the operator has to see
    it: a count of three over a screen marking two is a screen nobody trusts.
  */
  const drawn = new Set(sections.flatMap((s) => s.fields).map((f) => f.key));
  const rest = blockers.filter((key) => !drawn.has(key));
  if (rest.length > 0) {
    sections.push({
      id: "draft-rest",
      heading: "Also needed",
      fields: rest.map((key) => ({
        key,
        // The API's own words for it, capitalised: "A price", "Where to meet".
        label: capitalise(describeBlockers([key])[0]),
        value: null,
        step: stepOwning(key),
        missing: true,
      })),
    });
  }

  return sections;
}

function capitalise(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

/** How many fields stop this listing being sent. The API's own count. */
export function missingCount(listing: DraftListing): number {
  return (listing.publishBlockers ?? []).length;
}

/**
 * What the send button says.
 *
 * It stays on the screen when the listing is not ready, disabled and counting,
 * rather than disappearing: a button that is not there answers neither "can I
 * send this" nor "how much is left". "(1 thing missing)" is the whole
 * explanation, so nothing else has to say it.
 */
export function sendLabel(base: string, missing: number): string {
  if (missing <= 0) return base;
  return missing === 1
    ? `${base} (1 thing missing)`
    : `${base} (${missing} things missing)`;
}
