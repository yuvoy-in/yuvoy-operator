import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The layout resolves the session, and that is what lets the boundaries exist.
 *
 * A `loading.tsx` makes its route stream, and the status ships with the first
 * flushed byte — so a `redirect()` from inside the page runs too late. Measured
 * on a production build with a dead session cookie:
 *
 *     boundary + page-only check:  /calendar  ->  200, no Location
 *     layout gate + boundary:      /calendar  ->  307 -> /sign-in?next=%2Fcalendar
 *
 * Delete the `gateSession()` call and every boundaried route silently starts
 * answering 200 to a signed-out request. Nothing else fails: the build passes,
 * the units pass, the screen is correct once it arrives. Only an e2e asserting
 * a *status* notices, and most of these routes have none.
 *
 * So this pins the wiring itself, not the behaviour — the behaviour is pinned
 * by `day.spec.ts`'s "bounced off a page comes back to that page" and by
 * "a dead session lands on the sign-in form".
 */

const SRC = join(process.cwd(), "src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the layout session gate", () => {
  it("is called by the root layout", () => {
    const layout = stripComments(read("app/layout.tsx"));
    expect(layout).toMatch(/await\s+gateSession\s*\(\s*\)/);
  });

  /*
    Above `chromeData()`, which cannot throw by design — it swallows a dead
    session to protect the badges. If the gate ran after it, a revoked session
    would spend a full `/me` round trip before being turned away, and any
    future throw inside chromeData would pre-empt the redirect.
  */
  it("runs before the chrome data it must not depend on", () => {
    // The component body only — both names appear in the import block first.
    const src = stripComments(read("app/layout.tsx"));
    const body = src.slice(src.indexOf("export default async function"));
    expect(body.indexOf("gateSession")).toBeGreaterThan(-1);
    expect(body.indexOf("gateSession")).toBeLessThan(
      body.indexOf("chromeData"),
    );
  });

  /*
    The gate asks the same function every page asks. If it ever grows its own
    cookie-shaped shortcut it becomes the middleware check that `pnpm qa` §13b
    forbids — a redirect somebody can hold a dead session past.
  */
  it("decides via sessionState — redirecting, never throwing", () => {
    /*
      The gateSession BODY, not the whole file. `session.ts` is the one place
      allowed to touch cookies — `pnpm qa` requires that — so scanning the file
      would assert the opposite of the repo's own rule. What must stay true is
      narrower: the gate delegates the decision rather than sniffing for a
      cookie itself, which is the shortcut that would turn it into the
      middleware check §13b forbids.
    */
    const src = stripComments(read("lib/auth/session.ts"));
    const start = src.indexOf("export async function gateSession");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start);

    expect(body).toMatch(/sessionState\s*\(/);
    expect(body).not.toMatch(/SESSION_COOKIE|yvo_session|readSessionToken/);

    /*
      And it must NOT call requireOperator: that throws on an unclassifiable
      failure, and a throw from the layout escapes the page's error boundary,
      replacing "That did not load / Try again" with a generic failure on the
      one path an operator on bad signal actually hits.
    */
    expect(body).not.toMatch(/requireOperator\s*\(/);
  });

  /*
    The three doors must never be gated: sign-in redirecting to sign-in is an
    infinite loop, and /join/<token> is reached by somebody with no session by
    definition. Keyed off the same registry the chrome uses, so a door added
    there is a door the gate stands aside for.
  */
  it("stands aside for the chrome-less doors", () => {
    const gate = stripComments(read("lib/auth/session.ts"));
    expect(gate).toMatch(/isBareRoute\s*\(/);
  });

  /*
    Pages keep their own check. The gate is a second lock, never the only one:
    a page that somehow rendered without the layout must still refuse.
  */
  it("does not replace the per-page checks", () => {
    const pages = [
      "app/today/(root)/page.tsx",
      "app/bookings/(root)/page.tsx",
      "app/calendar/page.tsx",
    ];
    for (const p of pages) {
      expect(stripComments(read(p))).toMatch(/requireOperator\s*\(/);
    }
  });
});
