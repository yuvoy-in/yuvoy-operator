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
 * How the library is counted, in the operator's words.
 *
 * "8 items" was true and useless — the two things an operator comes to this
 * screen asking are "which of my photos is still waiting" and "did my reel get
 * approved", and one number answers neither.
 *
 * Items this build cannot name are counted separately and honestly rather than
 * folded into whichever kind is larger. If NOTHING can be named — an API that
 * has stopped sending `kind`, or a build talking to an older one — it falls
 * back to the count it can defend.
 */
export function countLibrary(items: readonly MediaItem[]): string {
  if (items.length === 0) return "Nothing yet";

  const counts = new Map<MediaKind, number>();
  let unnamed = 0;

  for (const item of items) {
    const kind = item.kind;
    if (kind && kind in KINDS) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    } else {
      unnamed += 1;
    }
  }

  const parts: string[] = [];
  // Fixed order, so the sentence does not reshuffle as an operator uploads.
  for (const kind of ["video", "image"] as const) {
    const n = counts.get(kind);
    if (!n) continue;
    const copy = KINDS[kind];
    parts.push(`${n} ${n === 1 ? copy.one : copy.many}`);
  }

  if (unnamed > 0) {
    parts.push(`${unnamed} ${unnamed === 1 ? "other item" : "other items"}`);
  }

  return parts.join(" · ");
}

/**
 * Whether this row can be taken down.
 *
 * Offered only where there is something to take down. A clip mid-upload, one
 * already withdrawn and one a reviewer refused are all things the operator
 * cannot act on, and a button that 404s teaches them to distrust the screen.
 */
const WITHDRAWABLE = new Set([
  "approved",
  "published",
  "attested",
  "in_moderation",
]);

export function canWithdraw(item: MediaItem): boolean {
  return Boolean(item.id) && WITHDRAWABLE.has(item.state ?? "");
}

/**
 * Approved, and attached to nothing — work already done that no traveller can
 * see.
 *
 * Only `approved` counts: an item still in review is not work waiting on the
 * operator, and saying so about every unfinished upload would make the notice
 * worth ignoring.
 */
export function unattached(items: readonly MediaItem[]): MediaItem[] {
  return items.filter(
    (m) => m.state === "approved" && !m.listing?.experienceId,
  );
}
