import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import ts from "typescript";
import { NAV, isBareRoute, isFocusedRoute } from "@/lib/site/nav";
import { DOOR_LABEL } from "@/components/states/route-skeletons";

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
 *
 * A page that redirects only on a condition (no session, a listing in
 * review) and draws a screen otherwise IS a screen, and every rule here holds
 * it. Leaving out every page that said `redirect(` anywhere, as this did,
 * left out the builder, which can also answer 404, so a boundary above it
 * would have streamed that 404 as a 200 with nothing here to say so; and
 * Business, verification and sign in went unchecked for their chassis.
 */
function isRedirect(file: string): boolean {
  let draws = false;
  const visit = (node: ts.Node) => {
    if (
      ts.isJsxElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxFragment(node)
    ) {
      draws = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(
    ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  );
  return !draws;
}

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

/*
  The links into the screens that keep no boundary. Read from the syntax tree
  (the TypeScript parser the typecheck already runs), not with patterns: a
  link's address is an expression, its children are JSX, and both hold
  words, quotes and comments a pattern would trip on.
*/
const SRC = join(process.cwd(), "src");

/** The pending hints a link can carry (`components/ui/link-pending.tsx`). */
const HINTS = new Set(["RowChevron", "LinkRing", "SegmentDot"]);

/** A route or an address with every dynamic part made alike: `/bookings/[]`. */
const shapeOf = (route: string) => route.replace(/\[[^\]]*\]/g, "[]");

/** An address as written: a template's substitutions are its dynamic parts. */
function written(expr: ts.Expression): string | null {
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    return expr.text;
  }
  if (ts.isTemplateExpression(expr)) {
    return expr.templateSpans.reduce(
      (text, span) => `${text}[]${span.literal.text}`,
      expr.head.text,
    );
  }
  return null;
}

/**
 * Where a link's `href` can go, as written at the link: the address itself,
 * either side of a choice, or the first argument of `withFrom` (its second is
 * where the screen goes back to). An address made anywhere else (a party's
 * `bookingHref`, a need's `href`) cannot be read here, and those links were
 * given their ring by hand.
 */
function addressesOf(expr: ts.Expression): string[] {
  if (ts.isParenthesizedExpression(expr)) return addressesOf(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    return [...addressesOf(expr.whenTrue), ...addressesOf(expr.whenFalse)];
  }
  if (
    ts.isCallExpression(expr) &&
    ts.isIdentifier(expr.expression) &&
    expr.expression.text === "withFrom" &&
    expr.arguments[0]
  ) {
    return addressesOf(expr.arguments[0]);
  }
  const address = written(expr);
  return address === null ? [] : [address.split(/[?#]/)[0]];
}

const tagOf = (node: ts.JsxOpeningLikeElement) => node.tagName.getText();

/** Whether a link's children draw one of the hints, at any depth. */
function hinted(node: ts.Node): boolean {
  if (
    (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
    HINTS.has(tagOf(node))
  ) {
    return true;
  }
  return ts.forEachChild(node, hinted) ?? false;
}

const treeOf = (file: string) =>
  ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );

/** The written-out (string) props of every `<tag>` in a file. */
function propsOf(file: string, tag: string): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  const visit = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagOf(node) === tag
    ) {
      const props: Record<string, string> = {};
      for (const p of node.attributes.properties) {
        if (ts.isJsxAttribute(p) && p.initializer) {
          if (ts.isStringLiteral(p.initializer)) {
            props[p.name.getText()] = p.initializer.text;
          }
        }
      }
      found.push(props);
    }
    ts.forEachChild(node, visit);
  };
  visit(treeOf(file));
  return found;
}

/** Each `<Link>` and `<ButtonLink>` in a file: its line, where it goes, its hint. */
function linksIn(file: string) {
  const tree = treeOf(file);
  const links: { line: number; to: string[]; hinted: boolean }[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (opening && ["Link", "ButtonLink"].includes(tagOf(opening))) {
      const href = opening.attributes.properties.find(
        (p): p is ts.JsxAttribute =>
          ts.isJsxAttribute(p) && p.name.getText() === "href",
      );
      const init = href?.initializer;
      const expr = init && ts.isJsxExpression(init) ? init.expression : init;
      links.push({
        line: tree.getLineAndCharacterOfPosition(opening.getStart()).line + 1,
        to: expr ? addressesOf(expr) : [],
        hinted: ts.isJsxElement(node) && node.children.some(hinted),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return links;
}

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
    Off the bar but tapped all the same, and none of them can answer 404:
    Team from Settings, Add a listing from Business, and the invitation door
    from a message. Each held the old screen on the glass with nothing to say
    the tap had landed (the stability audit, P2-1). `/team` and `/join` sit
    in a `(root)` group so the boundary is theirs alone, because a child of
    each calls `notFound()`.
  */
  it("cover the screens a button or a message leads to", () => {
    const TAPPED = ["/team", "/join", "/account/listings/new"];
    const found = PAGES.map(routeOf).filter((r) => TAPPED.includes(r));
    expect(found.sort()).toEqual([...TAPPED].sort());

    const uncovered = PAGES.filter((p) => TAPPED.includes(routeOf(p)))
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

  /*
    And what the rule costs, paid. With no boundary, nothing is painted
    between a tap and one of those screens, and Next prefetches none of them,
    so on one bar of signal a tap on a booking, a departure or a payout looked
    ignored (the stability audit, P2-1). Every link into one turns the ring a
    busy button turns, in the link itself: a row's chevron gives way to it,
    and words are followed by it. A new link into one of those screens without
    it is a dead tap again, and this names it.
  */
  it("and every link into one of them answers its own tap", () => {
    const detail = new Set(PAGES.filter(canNotFound).map(routeOf).map(shapeOf));
    const silent = walk(SRC)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .flatMap((file) =>
        linksIn(file)
          .filter((link) => link.to.some((to) => detail.has(shapeOf(to))))
          .filter((link) => !link.hinted)
          .map((link) => `${rel(file)}:${link.line}`),
      );

    expect(silent).toEqual([]);
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
    A door's fallback is that door: the caption on its stage and the measure
    of its sheet. It drew no caption and the narrow sheet for all three, so
    the caption appeared when a door landed and sign up's sheet widened under
    it (the stability audit, P3-3). Read from what each page and each
    boundary write, so a door that changes either is named here.
  */
  it("draw a door's own caption and measure", () => {
    const wrong = FILES.filter((f) => /\/loading\.tsx$/.test(f))
      .filter((boundary) => chassisOf(boundary) === "door")
      .flatMap((boundary) => {
        const drawn = propsOf(boundary, "DoorSkeleton")[0] ?? {};
        const width = drawn.width ?? "sm";
        return FILES.filter((f) => /\/page\.tsx$/.test(f))
          .filter((page) => boundaryFor(page) === boundary)
          .flatMap((page) =>
            propsOf(page, "Screen").map((screen) => {
              // `Screen`'s own default measure is md.
              const wears = screen.width ?? "md";
              const caption = screen.stageLabel ?? "none";
              return wears === width && caption === DOOR_LABEL
                ? null
                : `${routeOf(page)} wears ${wears} under "${caption}", ${rel(boundary)} draws ${width} under "${DOOR_LABEL}"`;
            }),
          );
      })
      .filter(Boolean);

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
