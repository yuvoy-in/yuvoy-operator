/**
 * The traveller's check-in link, read the way the API reads it
 * (yuvoy-operator#175).
 *
 * The QR on a traveller's booking (yuvoy-app#218, yuvoy-mobile#367) is the
 * link `checkin.Link` builds in yuvoy-api:
 *
 *     https://operators.yuvoy.in/check-in#YV-7K2Q4BCD.K7QM2XPA
 *
 * The reference and the code ride in the FRAGMENT, which a browser never
 * sends to a server. So this file is the only place they are read, in the
 * browser, and nothing here puts them in a query string, a cookie or a log.
 *
 * `readCheckInLink` is `checkin.ParseLink` and `normaliseCode` is
 * `invite.Normalise`, rule for rule, so a link the API would take is never
 * refused here and one it would refuse is never sent.
 */

/** `checkin.referencePattern`. */
const REFERENCE = /^YV-[0-9BCDFGHJKLMNPQRSTVWXYZ]{8}$/;

/** `invite.Alphabet`: no 0, O, 1, I or L. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const LENGTH = 8;

export interface CheckInLink {
  reference: string;
  code: string;
}

/**
 * A typed or scanned code as the API keeps it, or `null`.
 *
 * Any case; spaces, tabs and hyphens are dropped. Anything that is not ASCII
 * is refused before upper-casing, because `"ß".toUpperCase()` is `"SS"` here
 * and stays `ß` in Go, and the two must not disagree on a code.
 */
export function normaliseCode(typed: string): string | null {
  let code = "";
  for (const ch of typed) {
    if (ch === " " || ch === "-" || ch === "\t") continue;
    if (ch.charCodeAt(0) > 127) return null;
    const up = ch.toUpperCase();
    if (!ALPHABET.includes(up)) return null;
    code += up;
  }
  return code.length === LENGTH ? code : null;
}

/** `invite.Display`: `K7QM-2XPA`. */
export function displayCode(code: string): string {
  return code.length === LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/**
 * The reference and code in a link, or `null`.
 *
 * @param raw The whole link, `location.hash` with its `#`, or the fragment
 *   alone. Percent escapes are undone first, as `url.PathUnescape` does.
 */
export function readCheckInLink(
  raw: string | null | undefined,
): CheckInLink | null {
  if (!raw) return null;
  let fragment = raw.trim();
  /*
    The LAST fragment. A link has one, but after a hard load the Next router
    appends that first fragment to later navigations (`#a#b`, see
    `fragmentId` in account/help), and the one that counts is the newest.
  */
  const hash = fragment.lastIndexOf("#");
  if (hash !== -1) fragment = fragment.slice(hash + 1);
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    return null;
  }
  fragment = fragment.trim();
  const dot = fragment.indexOf(".");
  if (dot === -1) return null;
  const reference = fragment.slice(0, dot);
  if (!REFERENCE.test(reference)) return null;
  const code = normaliseCode(fragment.slice(dot + 1));
  return code ? { reference, code } : null;
}

/*
  Through sign-in, in the same tab.

  Signed out, the layout's gate answers `/check-in#...` with a 307 to
  `/sign-in?next=/check-in`. A browser carries the fragment across that
  redirect, so the sign-in page still has it. The sign-in action's own
  redirect back is a navigation Next makes, and that one drops it. So the
  sign-in page holds it in this tab's sessionStorage and `/check-in` takes it
  back, once. sessionStorage is per tab and never sent anywhere.
*/

const HELD = "yvo.check-in";
/** Long enough to ask for a code and type it, short enough to go stale. */
const HELD_FOR_MS = 15 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** Keep a check-in fragment for `/check-in`. Anything else is not kept. */
export function holdCheckInLink(raw: string, now = Date.now()): boolean {
  const link = readCheckInLink(raw);
  const store = storage();
  if (!link || !store) return false;
  try {
    store.setItem(HELD, JSON.stringify({ ...link, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** The held link, if one is fresh, and never the same one twice. */
export function takeHeldCheckInLink(now = Date.now()): CheckInLink | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(HELD);
    store.removeItem(HELD);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const held = JSON.parse(raw) as {
      reference?: unknown;
      code?: unknown;
      at?: unknown;
    };
    if (typeof held.at !== "number" || now - held.at > HELD_FOR_MS) {
      return null;
    }
    if (held.at > now) return null;
    return readCheckInLink(`${String(held.reference)}.${String(held.code)}`);
  } catch {
    return null;
  }
}
