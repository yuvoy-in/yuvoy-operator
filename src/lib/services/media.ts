import type { operations } from "@/lib/api/schema.gen";

/**
 * The operator's own library — one list holding photographs and clips.
 *
 * ## The rule this whole file exists to hold
 *
 * **A kind is read, never inferred.** Before yuvoy-api#119 the list carried no
 * `kind` at all and this portal deliberately labelled nothing, because the one
 * available guess — an absent `durationSeconds` means a photograph — is wrong
 * in the case that happens most: a clip that is still `uploaded` or
 * `processing` has no duration either, so the very first thing an operator saw
 * after posting a reel would have been that reel labelled a photograph.
 *
 * The field is on the wire now, and the rule survives it in a different form:
 * an item whose `kind` this build does not recognise is shown WITHOUT a claim
 * rather than sorted into the nearest bucket. That is the same call
 * `describeStatus` makes about an unknown listing status, for the same reason
 * — telling an operator something confident and wrong about their own media is
 * worse than telling them nothing.
 */

/** One row of `GET /operator/v1/media`, derived rather than retyped. */
export type MediaItem = NonNullable<
  NonNullable<
    operations["listOperatorMedia"]["responses"][200]["content"]["application/json"]["items"]
  >
>[number];

export type MediaKind = NonNullable<MediaItem["kind"]>;

interface KindCopy {
  /** On the chip. */
  label: string;
  /** "one reel", "two reels". */
  one: string;
  many: string;
  /**
   * The frame this row's picture is drawn in.
   *
   * A reel is upright and 9:16 — the uploader refuses anything else, so the
   * poster is always that shape. A photograph has no declared dimensions
   * anywhere in the contract and is most often landscape, so it gets a
   * gentler frame: cropping a 3:2 photo into a 9:16 slot removes most of it,
   * and this list's entire job is letting somebody recognise which one a row
   * is.
   */
  frame: string;
}

const KINDS: Record<MediaKind, KindCopy> = {
  video: {
    label: "Reel",
    one: "reel",
    many: "reels",
    frame: "aspect-[9/16]",
  },
  image: {
    label: "Photograph",
    one: "photograph",
    many: "photographs",
    frame: "aspect-[4/3]",
  },
};

/**
 * What to call this row, or nothing at all.
 *
 * `null` for an absent or unrecognised kind. Every caller has to render that
 * case, which is the point: it is a prompt to leave the claim off the screen
 * rather than a value to fall back on.
 */
export function describeKind(kind: string | undefined): KindCopy | null {
  if (kind === undefined) return null;
  return (KINDS as Record<string, KindCopy>)[kind] ?? null;
}

/**
 * What to say in the frame when there is no picture — yuvoy-operator#29.
 *
 * ## Why a single line is not enough
 *
 * 270 of 342 media assets have no stored poster, so this is the common row
 * rather than the edge case. One sentence for all of them flattens four
 * genuinely different situations: something still arriving, something waiting
 * on the operator, something waiting on us, and something a person refused.
 * The first three are "nothing is wrong" and the last is not, and an operator
 * scanning a list needs that difference at a glance.
 *
 * ## Why a clip has no picture, which is the part worth explaining
 *
 * A clip's poster resolves only once it is `published`. That is the
 * architecture's load-bearing rule, not an omission: unpublished, in-review
 * and quarantined footage needs signed short-lived URLs so a leaked asset id
 * cannot expose unvetted footage. And underneath it, a simpler fact — an
 * `uploaded` or `processing` clip has no still at any price, because the
 * provider has not made one yet.
 *
 * So the library, whose whole job is watching an upload move through review,
 * is mostly rows that must not have a public picture. Signed posters were the
 * alternative and the owner deferred them (7 Sep 2026): a day of backend work
 * to make grey boxes prettier on a product with three reels in it.
 *
 * ## One correction to the issue's grouping
 *
 * yuvoy-operator#29 groups `ready` with `attested` and `in_moderation` as
 * "waiting on us — the most reassuring thing this screen can say". `ready` is
 * NOT waiting on us: it means the rights have not been attested, which is the
 * operator's own next act, and this portal's state copy already says so
 * ("Needs rights. Confirm who owns this."). Calling it reassuring would park a
 * clip forever. It is grouped with `approved` instead — the two states where
 * the row is waiting on the person reading it.
 */
export interface MissingPreview {
  /** The line in the frame. Empty means draw the frame and say nothing. */
  line: string;
  /** Whether this is a normal part of the road, or something that went wrong. */
  faulted: boolean;
}

export function describeMissingPreview(item: MediaItem): MissingPreview {
  const state = item.state ?? "";

  /*
    A photograph with no picture is a FAULT, not a state.

    For an image the picture is the item, and the API builds its URL at read
    time from configuration rather than storing one — so there is no state in
    which a photograph legitimately has nothing to show. Explaining a clip's
    publication rule to somebody looking at a photo would be a confident wrong
    answer; saying it did not load is the true one.
  */
  if (item.kind === "image") {
    return {
      line: "This photograph did not load. Reload the page to try again.",
      faulted: true,
    };
  }

  switch (state) {
    case "uploaded":
    case "processing":
      // Nothing is wrong, and that is the whole message. Somebody who just
      // spent twenty minutes of island uplink reads an unexplained empty box
      // as a failed upload.
      return {
        line: "Still arriving. There is no still to show until the host has finished with it.",
        faulted: false,
      };

    case "ready":
    case "approved":
      // Waiting on the OPERATOR. See the note above about `ready`.
      return {
        line: "A reel gets its still when it goes live. The step below is yours.",
        faulted: false,
      };

    case "attested":
    case "in_moderation":
      // Waiting on US, and the issue is right that this is the most
      // reassuring thing the screen can say.
      return {
        line: "With us. A reel gets its still when it goes live.",
        faulted: false,
      };

    case "rejected":
    case "quarantined":
      /*
        Deliberately silent about the picture. `rejection.code` is a closed set
        and is rendered on the row below, which is the thing that matters — and
        "no preview yet" on a row a person refused reads as a technical hiccup
        rather than a decision.
      */
      return { line: "", faulted: true };

    case "withdrawn":
      /*
        Silent, like a refused row and for a related reason: the chip directly
        below already says "Taken down" and the body says what that means, so a
        tile repeating the word is noise on top of the answer.

        It is also a collision. `submitted.tsx` renders "Taken down" as the
        withdrawal receipt's heading, and a second paragraph carrying the same
        words made `reels.spec.ts`'s assertion resolve to one element or two
        depending on when the library re-rendered underneath it — a flake that
        would have become a hard failure on a slower machine.
      */
      return { line: "", faulted: false };

    case "failed":
      return { line: "Nothing arrived. Choose the file again.", faulted: true };

    case "published":
      /*
        Published and still no poster. Anomalous — a published clip is exactly
        the one that should have resolved one — so it is not dressed up as a
        normal part of the road.
      */
      return { line: "The still has not arrived yet.", faulted: true };

    default:
      // A state this build cannot name. Says the one true thing and no more,
      // the same call `describeKind` and `describeStatus` make.
      return { line: "No preview yet.", faulted: false };
  }
}
