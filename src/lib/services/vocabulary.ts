import type { components, operations } from "@/lib/api/schema.gen";

export type VocabularyTerm = components["schemas"]["VocabularyTerm"];

export type Vocabulary =
  operations["getCatalogVocabulary"]["responses"]["200"]["content"]["application/json"];

/**
 * What may go in a listing's category and destination — yuvoy-api#113.
 *
 * ## What this replaced, and why the replacement matters
 *
 * The create form asked for both as free text, seeded from the operator's own
 * existing listings. That worked for their second listing and was a dead end
 * for their first: a brand-new operator was shown a box and an example key,
 * and the only feedback was a `400` after they had filled the whole form in.
 * A hardcoded list was the other option and was refused — the market's
 * destinations are the server's, and a copy in the client disagrees the day
 * one opens.
 *
 * `GET /catalog/vocabulary` is the answer, and it carries what a picker needs:
 * "`andaman/havelock` is an identifier and 'Havelock (Swaraj Dweep)' is what an
 * operator calls the place; a picker showing only the key asks somebody to
 * recognise one."
 *
 * ## Categories come from the ENUM, not from this endpoint
 *
 * Both carry the same set, and only one of them is checked at build time. The
 * request body's `category` is a closed enum, so a value this portal invents is
 * a TypeScript error rather than a 400 — which is how the re-pin caught the old
 * free-text box the moment the enum landed.
 *
 * So the enum is the source of truth for *which* categories exist, and the
 * vocabulary supplies the *label*. If the two ever disagree, the enum wins and
 * the label falls back to a prettified key: showing a category the API would
 * refuse is worse than showing one with an ugly name.
 */

/** The categories the request body accepts. Narrowed by the generated type. */
export type Category = NonNullable<
  NonNullable<
    operations["createOperatorExperience"]["requestBody"]
  >["content"]["application/json"]["category"]
>;

export const CATEGORIES = [
  "adventure",
  "nature_wildlife",
  "food_drink",
  "arts_creativity",
  "learning",
  "culture_heritage",
  "wellness",
  "entertainment",
  "community",
  "sports",
  "local_life",
  "events",
] as const satisfies readonly Category[];

export function isCategory(v: string): v is Category {
  return (CATEGORIES as readonly string[]).includes(v);
}

/** `nature_wildlife` → `Nature wildlife`. The last-resort label. */
function prettify(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

export interface Choice {
  value: string;
  label: string;
}

/**
 * The category picker's options — every value the API accepts, labelled.
 *
 * Built from the ENUM and labelled from the vocabulary, never the other way
 * round. Driving the list from the response would let a slow or failed
 * vocabulary read empty a picker whose values are known at compile time, and
 * an operator cannot create a listing without choosing one.
 */
export function categoryChoices(vocabulary: Vocabulary | null): Choice[] {
  const labels = new Map(
    (vocabulary?.categories ?? [])
      .filter((t): t is { key: string; label: string } =>
        Boolean(t.key && t.label),
      )
      .map((t) => [t.key, t.label]),
  );
  return CATEGORIES.map((value) => ({
    value,
    label: labels.get(value) ?? prettify(value),
  }));
}

/**
 * The destination picker's options.
 *
 * These are rows, not an enum — "there is no enum here to go stale" — so
 * unlike categories the list itself has to come from the response. An empty
 * list is therefore a state to render rather than an error: "empty means we
 * have not opened one yet."
 *
 * Order is the server's. It is "the order a picker should show them", and
 * sorting alphabetically here would throw away whatever that ordering means.
 */
export function destinationChoices(vocabulary: Vocabulary | null): Choice[] {
  return (vocabulary?.destinations ?? [])
    .filter((t): t is { key: string; label?: string } => Boolean(t.key))
    .map((t) => ({ value: t.key, label: t.label || prettify(t.key) }));
}

/** The operator's market, for a picker that has nothing to offer. */
export function marketName(vocabulary: Vocabulary | null): string | null {
  return vocabulary?.market?.name ?? null;
}
