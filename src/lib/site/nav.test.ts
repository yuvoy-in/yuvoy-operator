import { describe, it, expect } from "vitest";
import {
  BARE_ROUTE_PREFIXES,
  FOCUSED_ROUTE_PREFIXES,
  NAV,
  isBareRoute,
  isFocusedRoute,
} from "./nav";

/**
 * Which screens hide the floating bar, and which draw no chrome at all.
 *
 * Two lists have to agree: the prefixes here, and the screens that pass a
 * `back` to `Screen`. Pinning the predicate per route keeps a new screen from
 * landing with a back control and a bar, or with neither.
 */
describe("focused and bare routes", () => {
  it.each([
    ["/today/slot_1", "focused"],
    ["/earnings", "focused"],
    ["/earnings?month=last", "focused"],
    ["/payouts", "focused"],
    ["/team", "focused"],
    ["/reels", "focused"],
    ["/sign-in", "bare"],
    ["/signup", "bare"],
    ["/join", "bare"],
    ["/today", "root"],
    ["/today?day=2026-09-03", "root"],
    ["/requests", "root"],
    ["/capacity", "root"],
    ["/account", "root"],
  ])("%s is %s", (pathname, kind) => {
    expect(isFocusedRoute(pathname)).toBe(kind === "focused");
    expect(isBareRoute(pathname)).toBe(kind === "bare");
  });

  it("never treats a tab root as focused or bare", () => {
    for (const item of NAV) {
      expect(isFocusedRoute(item.href)).toBe(false);
      expect(isBareRoute(item.href)).toBe(false);
    }
  });

  it("highlights Business for every screen behind its door", () => {
    const business = NAV.find((n) => n.icon === "business")!;
    for (const path of [
      "/account",
      "/earnings",
      "/payouts",
      "/team",
      "/reels",
    ]) {
      expect(business.match(path)).toBe(true);
    }
    expect(business.match("/today")).toBe(false);
  });

  it("answers false with no pathname rather than throwing", () => {
    expect(isFocusedRoute(null)).toBe(false);
    expect(isBareRoute(undefined)).toBe(false);
  });

  it("lists prefixes a tab root cannot match by accident", () => {
    for (const prefix of [...FOCUSED_ROUTE_PREFIXES, ...BARE_ROUTE_PREFIXES]) {
      for (const item of NAV) {
        expect(item.href.startsWith(prefix)).toBe(false);
      }
    }
  });
});
