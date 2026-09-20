import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";

/**
 * No authenticated route may have a `loading.tsx`. Not yet.
 *
 * ## The defect, measured
 *
 * A loading boundary makes its route STREAM, and the HTTP status goes out with
 * the first flushed byte — so `redirect()` runs too late to set one, exactly
 * as `notFound()` does. Every screen in this portal calls `requireOperator()`,
 * which redirects a signed-out or expired session to `/sign-in?next=...`.
 *
 * Boundaries were built for every screen here on 19 Sep, passed the full gate,
 * and were pulled before shipping once this was measured against a production
 * build with a dead session cookie:
 *
 *     with a boundary:  /calendar /today /bookings  ->  200, no Location
 *     without one:      /earnings /team             ->  307 -> /sign-in?next=
 *
 * No operator data leaks — `requireOperator` throws before anything renders —
 * but a protected page answering 200 to a signed-out request is wrong, it
 * races (it flaked `day.spec.ts`'s "bounced off a page" test), and it paints a
 * skeleton before the bounce.
 *
 * ## Why this file exists rather than a comment
 *
 * The reasoning lives in `next.config.ts`, and a comment stops nobody. Adding
 * a `loading.tsx` is the obvious, correct-looking fix for the portal feeling
 * slow — it IS the fix, in any app whose routes do not redirect — and nothing
 * else in the gate fails when it is added here. The build passes, the unit
 * tests pass, the screen is right once it arrives. Only an e2e that asserts a
 * *status* notices, and most of these routes have none.
 *
 * ## What unlocks it
 *
 * Moving the session check into middleware, which runs before the response
 * starts and can still issue a real 307 whatever the route does afterwards.
 * This repo already has middleware. When that lands, delete this file in the
 * same change — and put the boundaries back, because the lag they fix is real.
 */

const APP = join(process.cwd(), "src/app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const FILES = walk(APP);
const rel = (f: string) => relative(process.cwd(), f);

/**
 * Scan CODE, not prose — a comment naming `requireOperator` is not a call to
 * it. The sibling test in yuvoy-app hit this for real: an explanatory comment
 * made the scanner fail two routes that obeyed the rule it explained.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Does this page sit behind the session, and therefore redirect? */
const isAuthenticated = (file: string) =>
  /\brequireOperator\s*\(/.test(stripComments(readFileSync(file, "utf8")));

const PAGES = FILES.filter((f) => /\/page\.tsx$/.test(f));

/** The nearest `loading.tsx` at or above a page — Suspense nests upward. */
function boundaryFor(page: string): string | null {
  let dir = dirname(page);
  for (;;) {
    const candidate = join(dir, "loading.tsx");
    if (FILES.includes(candidate)) return candidate;
    if (dir === APP) return null;
    dir = dirname(dir);
  }
}

describe("loading boundaries", () => {
  it("never sit above a route that redirects for auth", () => {
    const streamed = PAGES.filter(isAuthenticated)
      .map((page) => {
        const b = boundaryFor(page);
        return b
          ? `${rel(page)} would stream via ${rel(b)} — its 307 to /sign-in becomes a 200`
          : null;
      })
      .filter(Boolean);

    expect(streamed).toEqual([]);
  });

  /*
    A root boundary cannot be scoped or opted out of, so it would put every
    authenticated route in the portal back to answering 200 at once. Called
    out separately from the rule above because it is the single change most
    likely to be made, and the failure above would name 24 files at once
    without saying why they are all suddenly wrong.
  */
  it("do not exist at the app root at all", () => {
    expect(FILES).not.toContain(join(APP, "loading.tsx"));
  });

  /*
    The rule is only affordable because it is universal here: if some screen
    ever stops requiring a session, it may safely have a boundary and this
    guard should be narrowed deliberately rather than deleted in frustration.
  */
  it("guard a portal where every screen is behind the session", () => {
    const open = PAGES.filter((p) => !isAuthenticated(p)).map(rel);
    // The three doors and the redirect stubs; everything else must be authed.
    const EXPECTED_OPEN = /\/(sign-in|signup|join|services|page\.tsx$)/;
    expect(open.filter((f) => !EXPECTED_OPEN.test(f))).toEqual([]);
  });
});
