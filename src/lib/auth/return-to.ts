import { FOCUSED_ROUTE_PREFIXES, NAV } from "@/lib/site/nav";

/**
 * Where to send somebody after they sign in.
 *
 * An operator taps a link to a booking, their session has expired, and they
 * are bounced to `/sign-in`. Landing them on `/today` afterwards means finding
 * that booking again — on a phone, usually with somebody standing in front of
 * them. So the path they were reaching for travels with them as `?next=`.
 *
 * ## This is the file where an open redirect would live
 *
 * `?next=` is attacker-controlled by construction: anybody can send an
 * operator a link to `operators.yuvoy.in/sign-in?next=…`. Handed to
 * `redirect()` unchecked, it forwards them to any site on the internet
 * **after** a successful sign-in — from a real Yuvoy URL, at the moment they
 * are most primed to trust what they see next. That is a credible phishing
 * chain, not a theoretical one.
 *
 * So the rule is an allowlist of shape, not a denylist of tricks: it must be
 * one absolute path on this origin, and anything else becomes `null` and falls
 * back to the portal's own home. Every branch below is a real bypass that
 * `startsWith("/")` alone lets through.
 */

/*
  Control characters, written as escapes rather than pasted in.

  These regexes originally held the literal bytes. They worked, which is the
  problem: a NUL and a DEL sitting invisibly in a source file are unreviewable,
  and nothing complained — eslint's `no-control-regex` is not enabled in this
  config, and it only looks at escape sequences anyway. `pnpm qa` now fails a
  literal control byte anywhere in `src/`, which is the check that would have
  caught it.

  A newline or a carriage return inside a `Location` header is response
  splitting. A tab, a vertical tab or a zero-width space is enough to walk a
  naive prefix check past `//`. Trailing whitespace is included in the first
  because `"/today "` is not a route and is not worth guessing about.
*/
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_OR_SPACE = /[\u0000-\u001f\u007f-\u009f\s]/;

/** Where a signed-in operator belongs when nothing better is known. */
export const HOME_PATH = "/today";

/**
 * The paths a return may point at, by prefix.
 *
 * An allowlist rather than "any path", because the useful set is small and a
 * bounded one cannot be reasoned around. `/sign-in`, `/signup` and `/join` are
 * structurally absent: they are the BARE routes, returning to one after
 * signing in is a loop, and `/join` is not a place to land with a session.
 *
 * ## Derived, because the hand-written version went stale twice
 *
 * This was a literal list and it drifted the moment a route moved — silently,
 * and in the worst direction: a bounced operator lost the page they were on
 * and landed on Today, which is the exact failure `?next=` exists to prevent.
 * By the time yuvoy-operator#32 renamed two tabs, the list still said
 * `/reels` (moved under `/services` in #22) and had never learned `/profile`
 * or `/services` at all.
 *
 * So it is built from the navigation registry and the focused-route list, the
 * same two sources the chrome reads. A destination that exists is returnable
 * by construction, and renaming one cannot leave this behind.
 */
const RETURNABLE = [
  ...NAV.map((item) => item.href),
  ...FOCUSED_ROUTE_PREFIXES,
  /*
    The two renamed URLs, which are 308s rather than deletions
    (yuvoy-operator#32). An operator bounced off an old bookmark should land
    back on it and be forwarded, not lose their place because the link they
    held was the old one.
  */
  "/requests",
  "/capacity",
].map((path) =>
  // `FOCUSED_ROUTE_PREFIXES` carries trailing slashes (`/today/`) so it cannot
  // catch the tab root; the match below adds one back, so it is stripped here
  // to keep a single form in this list.
  path.endsWith("/") ? path.slice(0, -1) : path,
);

/**
 * A `?next=` value, if it is safe to send somebody to, or `null`.
 *
 * @param raw What arrived in the query string.
 */
export function safeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;

  /*
    Control characters first, before anything is matched on. A newline or a
    NUL inside a Location header is response splitting, and a tab or a
    zero-width space is enough to walk a naive prefix check past `//`.
  */
  if (CONTROL_OR_SPACE.test(raw)) return null;

  /*
    Must be an absolute path on this origin, and `/` is not enough on its own:

      `//evil.com`      — protocol-relative. A browser reads it as a host.
      `/\evil.com`      — the same thing to every major browser, which treat a
                          backslash as a slash in a URL.
      `/%2f%2fevil.com` — the same again once the browser decodes it.
      `https://evil.com`— the obvious one, and the only one a naive check
                          usually catches.
  */
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw.includes("\\")) return null;

  /*
    Decoded before the prefix check, because `%2f%2fevil.com` and `%5c` are the
    same two bypasses wearing an encoding. A value that will not decode is
    malformed and is refused rather than guessed at.
  */
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.startsWith("//") || decoded.startsWith("/\\")) return null;
  if (decoded.includes("\\")) return null;
  if (CONTROL.test(decoded)) return null;

  /*
    Compared on the path alone. A query string is kept — a manifest filter is
    worth returning to — but it must not be what decides the allowlist, or
    `/today?x=/../../evil` would be judged on the wrong string.
  */
  const path = raw.split("?")[0].split("#")[0];
  if (path.includes("..")) return null;

  const allowed = RETURNABLE.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
  return allowed ? raw : null;
}

/** `/sign-in`, carrying where to come back to when that is worth doing. */
export function signInPathFor(
  target: string | null | undefined,
  signInPath = "/sign-in",
): string {
  const safe = safeReturnPath(target);
  /*
    `/today` is where sign-in lands anyway, so appending it would put a query
    string on the URL that changes nothing — noise in a bookmark, and one more
    thing to be wrong.
  */
  if (!safe || safe === HOME_PATH) return signInPath;
  return `${signInPath}?next=${encodeURIComponent(safe)}`;
}
