import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { NAV, isBareRoute, isFocusedRoute } from "@/lib/site/nav";

/**
 * Every route reaches a loading boundary, and it is the right one.
 *
 * ## The defect this exists for
 *
 * This portal shipped thirty-one routes and zero `loading.tsx` files. Every
 * route is `force-dynamic` — they all read the session cookie, which is
 * correct — and for a dynamic route with no loading boundary the framework
 * does two things, both documented:
 *
 *   - **It skips prefetching the route entirely.** Next partially prefetches a
 *     dynamic route when it can find a `loading.tsx`, and prefetches nothing
 *     when it cannot. So no tap in this portal was ever prefetched.
 *   - **It paints nothing while it waits.** With no Suspense boundary the
 *     router holds the previous screen until the new one has finished
 *     rendering on the server. Home alone reads seven things first. On a dock
 *     on one bar of signal, the tap looks ignored.
 *
 * That is the whole of the "clicking nav links lags and opens after some time"
 * report, and nothing else in the gate would ever have failed for it: the
 * build passes, the tests pass, the screen is correct once it arrives.
 *
 * ## The second half is the one that rots
 *
 * Having *a* boundary is easy to keep. Having the boundary that matches the
 * chassis is not, because the chassis is decided somewhere else — in
 * `FOCUSED_ROUTE_PREFIXES` and `BARE_ROUTE_PREFIXES`. Move a route between
 * those lists and the skeleton silently starts painting a tab bar for a screen
 * that has none, or a bare door for a screen that has a bar. It is a flash, so
 * nobody files it and everybody sees it. This test reads the same registry the
 * chrome reads, so the two cannot disagree.
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

/** `src/app/today/[slotId]/page.tsx` -> `/today/[slotId]`; the root -> `/`. */
const routeOf = (page: string) =>
  "/" +
  relative(APP, dirname(page))
    .split("/")
    .filter((s) => s && !(s.startsWith("(") && s.endsWith(")")))
    .join("/");

/**
 * A redirect is not a screen. `/`, `/services/activities` and
 * `/services/reels` exist only to send an old URL somewhere current; they
 * render no UI, so a skeleton for them would be a skeleton for nothing.
 */
const isRedirect = (file: string) =>
  /\bredirect\(/.test(readFileSync(file, "utf8"));

/**
 * ## The redirect half of this was solved, not worked around
 *
 * Boundaries here were pulled once on 19 September because a streamed route
 * flushes its status before `redirect()` runs, so every `requireOperator()`
 * bounce became a 200 instead of a 307. They are back because the session is
 * now resolved in the LAYOUT (`lib/auth/gate.ts`), which renders above every
 * boundary — nothing has flushed when the redirect fires. `auth-gate.test.ts`
 * pins that the gate is wired; this file pins the half it does NOT solve.
 *
 * A route that can answer 404 must NOT sit under a loading boundary.
 *
 * This is the trade-off that made the first attempt at this change wrong, and
 * it cost eleven e2e failures to find. A loading boundary makes the route
 * STREAM: Next flushes the shell as soon as the page suspends, and the HTTP
 * status goes out with that first byte. `notFound()` then runs too late to
 * change it, so `/today/<somebody else's slot>` answered **200** with the
 * not-found screen inside it instead of 404 — measured, not theorised.
 *
 * Eight routes here call `notFound()`, every one of them a detail screen
 * reached by tapping a row rather than a nav link. So the rule costs nothing
 * an operator feels, and the boundaries stay where the taps are: a route group
 * scopes `/today`, `/bookings` and `/account` to their own page, so those tab
 * roots keep their fallback while their 404-capable children stay unstreamed.
 *
 * That is also why there is no root `loading.tsx` in this repo. A boundary at
 * the root cannot be scoped or opted out of — it would silently turn every one
 * of those eight into a 200.
 */
/**
 * Scan CODE, not prose.
 *
 * Every rule here is written down next to the thing it constrains, so the
 * three `(root)/page.tsx` files explain in a comment that their children call
 * `notFound()`. Reading comments made this report the two tab roots as
 * 404-capable and fail a rule they obey — the same trap `palette.test.ts`
 * documents, and the reason a scanner that reads prose teaches people to
 * delete the explanation rather than keep the rule.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const canNotFound = (file: string) =>
  /\bnotFound\(\)/.test(stripComments(readFileSync(file, "utf8")));

const PAGES = FILES.filter((f) => /\/page\.tsx$/.test(f)).filter(
  (f) => !isRedirect(f),
);

/** The nearest `loading.tsx` at or above a page. */
function boundaryFor(page: string): string | null {
  let dir = dirname(page);
  for (;;) {
    const candidate = join(dir, "loading.tsx");
    if (FILES.includes(candidate)) return candidate;
    if (dir === APP) return null;
    dir = dirname(dir);
  }
}

/** Which chassis a boundary draws, read from what it imports. */
function chassisOf(boundary: string): "tabs" | "focused" | "door" {
  const src = readFileSync(boundary, "utf8");
  if (/DoorSkeleton/.test(src)) return "door";
  if (/FocusedSkeleton/.test(src)) return "focused";
  return "tabs";
}

/** Which chassis a route actually wears, from the registry the chrome uses. */
const chassisFor = (route: string) =>
  isBareRoute(route) ? "door" : isFocusedRoute(route) ? "focused" : "tabs";

describe("loading boundaries", () => {
  /*
    Every tap an operator makes from the chrome. These are the screens the lag
    report was about, and each one must paint something in the first frame.
  */
  it("cover every route reachable from the navigation", () => {
    const NAV_ROUTES = [
      "/today",
      "/bookings",
      "/calendar",
      // The Money tab (yuvoy-operator#96). Its page sits in an `(root)`
      // group so the boundary is the tab's and not one settlement's.
      "/earnings",
      "/account",
      "/messages",
      "/notifications",
    ];
    const uncovered = PAGES.filter((p) => NAV_ROUTES.includes(routeOf(p)))
      .filter((p) => boundaryFor(p) === null)
      .map(rel);

    expect(uncovered).toEqual([]);
  });

  /*
    THE ONE THAT CAUGHT THIS. A boundary above a `notFound()` streams a 200
    shell and the status can never be corrected. Re-adding a root
    `loading.tsx`, or one on a detail segment, would put every affected route
    back to answering 200 — and the only thing that notices is an e2e test
    asserting a status, which not every one of these routes has.
  */
  it("never sit above a route that can answer 404", () => {
    const streamed = PAGES.filter(canNotFound)
      .map((page) => {
        const b = boundaryFor(page);
        return b ? `${routeOf(page)} would stream via ${rel(b)}` : null;
      })
      .filter(Boolean);

    expect(streamed).toEqual([]);
  });

  /*
    And the reason that rule is affordable: a 404-capable route is always a
    detail screen somebody taps a row to reach, never a stop on the bar. If
    that ever stops being true, this fails and the trade-off gets re-decided
    deliberately rather than by whoever adds the route.
  */
  it("because nothing that can 404 is a navigation destination", () => {
    const onTheBar = PAGES.filter(canNotFound)
      .map(routeOf)
      .filter((r) => NAV.some((item) => item.href === r));

    expect(onTheBar).toEqual([]);
  });

  it("draw the chassis the nav registry says the route wears", () => {
    const wrong = PAGES.map((page) => {
      const route = routeOf(page);
      const boundary = boundaryFor(page);
      if (!boundary) return null;
      const drawn = chassisOf(boundary);
      const expected = chassisFor(route);
      return drawn === expected
        ? null
        : `${route}: wears ${expected}, ${rel(boundary)} draws ${drawn}`;
    }).filter(Boolean);

    expect(wrong).toEqual([]);
  });

  /*
    A fallback that renders nothing is worse than none: it blanks the screen
    instead of holding the old one, and it satisfies the coverage check above.
  */
  it("draw a real chassis rather than an empty element", () => {
    const empty = FILES.filter((f) => /\/loading\.tsx$/.test(f))
      .filter(
        (f) =>
          !/(SheetSkeleton|FocusedSkeleton|DoorSkeleton)/.test(
            readFileSync(f, "utf8"),
          ),
      )
      .map(rel);

    expect(empty).toEqual([]);
  });
});
