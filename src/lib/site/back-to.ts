/**
 * Where Back goes from a screen opened from somewhere, carried in its URL.
 *
 * The portal's Back is a plain link to a stated place, never `history.back()`
 * ("history is not ours to read on a phone that was handed over
 * mid-morning"). It used to be a FIXED place, which was often not where the
 * operator came from (audit 5.8): a booking opened from a departure went back
 * to the bookings list, and a booking opened from a search went back to the
 * list with the search gone.
 *
 * So the screen that links adds its own address as `?from=`, and the screen
 * opened reads it back through `backFrom`, which accepts only the portal's
 * own screens. Anything else (another site, a protocol, a path this file
 * does not know, something too long) falls back to the screen's stated
 * default, so a link somebody edits by hand can only ever lead somewhere
 * ordinary. A screen's own `from` rides along in the address it hands on, so
 * Back can walk more than one step; each step is checked when its screen
 * renders.
 */
export interface BackTarget {
  href: string;
  /** Finishes "Back to ...". */
  label: string;
}

const ID = "[A-Za-z0-9_-]{1,80}";

const PLACES: { match: RegExp; label: string; keepQuery: boolean }[] = [
  { match: /^\/today$/, label: "the day", keepQuery: false },
  {
    match: new RegExp(`^/today/(?!listing$)${ID}$`),
    label: "the departure",
    keepQuery: true,
  },
  {
    match: new RegExp(`^/today/listing/${ID}$`),
    label: "the listing",
    keepQuery: true,
  },
  { match: /^\/bookings$/, label: "bookings", keepQuery: true },
  {
    match: new RegExp(`^/bookings/${ID}$`),
    label: "the booking",
    keepQuery: true,
  },
  { match: /^\/messages$/, label: "messages", keepQuery: false },
  { match: /^\/calendar$/, label: "the calendar", keepQuery: true },
];

/** The longest `from` accepted: a bookings search with every filter fits. */
export const MAX_FROM = 600;

/** A stand-in origin, only so `URL` can parse a path; never shown or fetched. */
const BASE = "https://portal.invalid";

export function backFrom(
  from: string | string[] | undefined,
  fallback: BackTarget,
): BackTarget {
  const raw = Array.isArray(from) ? from[0] : from;
  if (!raw || raw.length > MAX_FROM) return fallback;
  // A path of ours, and nothing a browser would read as another host.
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\s]/.test(raw)) {
    return fallback;
  }
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  const place = PLACES.find((p) => p.match.test(url.pathname));
  if (!place) return fallback;
  return {
    href: place.keepQuery ? `${url.pathname}${url.search}` : url.pathname,
    label: place.label,
  };
}

/**
 * `href` with `from` added, for a link whose Back should come here. A `#`
 * on the link stays last, where a browser reads it.
 */
export function withFrom(href: string, from: string): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const rest = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = rest.indexOf("?");
  const path = queryAt >= 0 ? rest.slice(0, queryAt) : rest;
  const params = new URLSearchParams(
    queryAt >= 0 ? rest.slice(queryAt + 1) : "",
  );
  params.set("from", from);
  return `${path}?${params.toString()}${hash}`;
}

/**
 * The address a screen hands on as `from`: its path and the query it was
 * opened with, so a search, a pill or its own `from` survives the round trip.
 */
export function hereWith(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string" && value !== "") params.set(key, value);
    else if (Array.isArray(value) && value[0]) params.set(key, value[0]);
  }
  const search = params.toString();
  return search ? `${pathname}?${search}` : pathname;
}
