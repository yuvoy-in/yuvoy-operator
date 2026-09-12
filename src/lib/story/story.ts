/**
 * The business's own story — yuvoy-operator#41.
 *
 * Not `/profile`. That is the LEGAL identity — registered name, entity type,
 * GSTIN, registered address — compliance data a traveller never sees. This is
 * "the half a person reads before deciding whether to get on a stranger's
 * boat", drawn on the business's public page in the traveller app.
 *
 * Pure, so a client component can use it: the screen counts as the operator
 * types, and the Server Action checks the same rules before it spends a
 * request finding out.
 */

import { dedashText } from "@/lib/format/dedash";

/** Fewer than this is "two words on a trust surface". Empty is allowed. */
export const ABOUT_MIN = 40;
/** "Nobody reads more on a phone at a jetty." */
export const ABOUT_MAX = 600;
/** The most languages the API keeps. */
export const LANGUAGES_MAX = 8;
/** The most photographs a business's page shows. */
export const PHOTOS_MAX = 5;

export interface StoryPhoto {
  id: string;
  /** 1 to 5, chosen by the API: the lowest free slot. */
  position: number;
  /** Absent when image hosting is unavailable — never a broken URL. */
  url: string | null;
}

export interface Story {
  about: string;
  languages: string[];
  photos: StoryPhoto[];
  /**
   * The two facts a traveller reads as checked. "Render them, do not offer
   * them as inputs."
   */
  reviewed: {
    operatingSince: number | null;
    findThemAt: string | null;
    why: string | null;
  };
}

/**
 * `GET /story`, read so that "not set" has one shape.
 *
 * The API writes what its columns hold: an unset year is `null`, an unset
 * address is `""`, and a business that never chose a language sends `null`
 * rather than `[]`. A screen branching on each of those separately would
 * sooner or later print "Running since null".
 *
 * `null` for a response that is not a story at all, which the page treats
 * exactly like a failed read — saving over a story it could not show would
 * overwrite what travellers already see.
 */
export function toStory(raw: unknown): Story | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const reviewed = (
    r.reviewed && typeof r.reviewed === "object" ? r.reviewed : {}
  ) as Record<string, unknown>;
  const since = reviewed.operatingSince;

  const photos = Array.isArray(r.photos)
    ? r.photos
        .map((p): StoryPhoto | null => {
          if (!p || typeof p !== "object") return null;
          const o = p as Record<string, unknown>;
          const id = typeof o.id === "string" ? o.id : "";
          const position = typeof o.position === "number" ? o.position : NaN;
          if (!id || !Number.isInteger(position)) return null;
          return { id, position, url: textOrNull(o.url) };
        })
        .filter((p): p is StoryPhoto => p !== null)
        .sort((a, b) => a.position - b.position)
    : [];

  return {
    about: typeof r.about === "string" ? r.about : "",
    languages: Array.isArray(r.languages)
      ? r.languages.filter(
          (l): l is string => typeof l === "string" && l.trim() !== "",
        )
      : [],
    photos,
    reviewed: {
      operatingSince:
        typeof since === "number" && Number.isInteger(since) ? since : null,
      findThemAt: textOrNull(reviewed.findThemAt),
      why: dedashText(textOrNull(reviewed.why)),
    },
  };
}

/**
 * How long `about` is, measured the way the API measures it.
 *
 * `SaveStory` trims and then checks `len(about)` — and Go's `len` of a string
 * is its BYTES of UTF-8, not its characters (yuvoy-api
 * `operator_public_identity.go`). For plain English the two agree. They part
 * company on exactly what a phone types on its own — a curly apostrophe or an
 * em dash is three bytes — and on every word of Hindi or Bengali, three bytes
 * a letter. A counter of characters would say "590 of 600" over a paragraph
 * the API refuses, which is the one thing a counter must never do.
 *
 * Raised on yuvoy-operator#41. If the API moves to counting characters, this
 * is the line that changes.
 */
export function aboutSize(text: string): number {
  return new TextEncoder().encode(text.trim()).length;
}

/** Whether the count runs ahead of the letters, so the screen can say why. */
export function countsFaster(text: string): boolean {
  const trimmed = text.trim();
  return aboutSize(trimmed) !== [...trimmed].length;
}

/** What is wrong with `about` as the API would judge it, or nothing. */
export function aboutIssue(text: string): string | null {
  const size = aboutSize(text);
  // "Sending it empty clears it" — somebody who has not written theirs yet is
  // not blocked from saving their languages.
  if (size === 0) return null;
  if (size < ABOUT_MIN) {
    return `At least ${ABOUT_MIN} characters, or leave it empty. Two words on your page reads worse than none.`;
  }
  if (size > ABOUT_MAX) {
    return `${ABOUT_MAX} characters at most. This is ${size}.`;
  }
  return null;
}

/**
 * What was typed into the languages box, as the list the API keeps.
 *
 * Commas, semicolons or new lines between them — whatever a thumb reached
 * for. Blanks go, and repeats go keeping the first spelling: the API drops
 * exact repeats itself, but "English" and "english" would both reach a
 * traveller's screen.
 *
 * Cleaned HERE, before counting, because the API counts before it cleans —
 * `len(languages) > 8` runs first, so nine entries with a blank among them
 * would be refused for being too many.
 */
export function parseLanguages(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of input.split(/[,;\n]/)) {
    const name = part.trim().replace(/\s+/g, " ");
    const key = name.toLocaleLowerCase("en-IN");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Too many languages, or nothing. */
export function languagesIssue(languages: readonly string[]): string | null {
  return languages.length > LANGUAGES_MAX
    ? `${LANGUAGES_MAX} languages at most. This is ${languages.length}.`
    : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
