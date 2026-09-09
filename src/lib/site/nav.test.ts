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
    ["/profile", "focused"],
    ["/logo", "focused"],
    ["/earnings", "focused"],
    ["/earnings?month=last", "focused"],
    ["/payouts", "focused"],
    ["/team", "focused"],
    ["/sign-in", "bare"],
    ["/signup", "bare"],
    ["/join", "bare"],
    ["/today", "root"],
    ["/today?day=2026-09-03", "root"],
    ["/bookings", "root"],
    ["/calendar", "root"],
    ["/account", "root"],
    /*
      ONE booking is focused; the list is not (yuvoy-operator#34). The
      distinction is the slash, and it is worth pinning: `/bookings/` catching
      `/bookings` would hide the tab bar on a tab root, and not catching
      `/bookings/<id>` would leave a detail screen with no way back.
    */
    ["/bookings/bk_1", "focused"],
    /*
      The two old URLs still resolve — they are 308s, not deletions, because
      they are in operators' history and in messages we have sent. They stay
      roots so the redirect does not flash an unlit bar on its way through.
    */
    ["/requests", "root"],
    ["/capacity", "root"],
    /*
      Both halves of Manage services are ROOTS, not focused screens
      (yuvoy-operator#22). Reels was focused while it lived behind the Business
      door; it is now one of a pair an operator moves between constantly —
      "this activity has no video" and "this clip is attached to nothing" are
      the same question from both ends — and a back control that left the
      section would be in the way every time.
    */
    ["/services/activities", "root"],
    ["/services/reels", "root"],
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

  it("lights Bookings and Calendar for their old URLs too", () => {
    /*
      A 308 renders for an instant before the browser follows it. Matching the
      old path means that instant shows the right stop lit rather than a bar
      with nothing active, which reads as the portal losing its place.
    */
    const bookings = NAV.find((n) => n.icon === "bookings")!;
    const calendar = NAV.find((n) => n.icon === "calendar")!;
    expect(bookings.match("/requests")).toBe(true);
    expect(bookings.match("/bookings/bk_1")).toBe(true);
    expect(calendar.match("/capacity")).toBe(true);
    // And they must not both light at once.
    expect(calendar.match("/requests")).toBe(false);
    expect(bookings.match("/capacity")).toBe(false);
  });

  it("highlights Business for every screen behind its door", () => {
    const business = NAV.find((n) => n.icon === "business")!;
    for (const path of ["/account", "/earnings", "/payouts", "/team"]) {
      expect(business.match(path)).toBe(true);
    }
    expect(business.match("/today")).toBe(false);
  });

  it("highlights Services for both of its pages, and Business for neither", () => {
    /*
      The stop points at `/services/activities` and matches the whole section,
      so an operator on Reels sees Services lit rather than nothing. Business
      must NOT also match, or two stops would read as active at once — which is
      what happened while `/reels` was still in its prefix list.
    */
    const services = NAV.find((n) => n.icon === "services")!;
    const business = NAV.find((n) => n.icon === "business")!;
    for (const path of [
      "/services",
      "/services/activities",
      "/services/reels",
    ]) {
      expect(services.match(path)).toBe(true);
      expect(business.match(path)).toBe(false);
    }
    expect(services.match("/account")).toBe(false);
  });

  it("has exactly one stop matching any given screen", () => {
    /*
      Five stops now, and every one of them is a prefix test. Two matching the
      same path lights two pills at once and makes `aria-current="page"` a lie
      — asserted across every screen the portal has rather than only the ones
      that changed.
    */
    for (const path of [
      "/today",
      "/today/slot_1",
      "/requests",
      "/capacity",
      "/services/activities",
      "/services/reels",
      "/account",
      "/earnings",
      "/payouts",
      "/team",
    ]) {
      const matched = NAV.filter((n) => n.match(path));
      expect(
        matched.map((n) => n.icon),
        `for ${path}`,
      ).toHaveLength(1);
    }
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
