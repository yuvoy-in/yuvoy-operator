import { describe, expect, it } from "vitest";
import { backFrom, hereWith, MAX_FROM, withFrom } from "./back-to";

const BOOKINGS = { href: "/bookings", label: "bookings" };

/*
  Audit 5.8: Back went to a fixed parent, which was often not where the
  operator came from. The opener's address rides in `?from=`, and only the
  portal's own screens are accepted from it.
*/
describe("where Back goes", () => {
  it("goes where the operator came from", () => {
    expect(backFrom("/today/slot_dawn", BOOKINGS)).toEqual({
      href: "/today/slot_dawn",
      label: "the departure",
    });
    expect(backFrom("/messages", BOOKINGS)).toEqual({
      href: "/messages",
      label: "messages",
    });
    expect(backFrom("/today", BOOKINGS)).toEqual({
      href: "/today",
      label: "the day",
    });
  });

  it("keeps the search and the pill a list was left on", () => {
    expect(backFrom("/bookings?view=upcoming&q=YV-7K3", BOOKINGS)).toEqual({
      href: "/bookings?view=upcoming&q=YV-7K3",
      label: "bookings",
    });
  });

  it("keeps a screen's own way back, so Back can walk more than one step", () => {
    expect(
      backFrom("/bookings/bkg_1?from=%2Ftoday%2Fslot_dawn", BOOKINGS).href,
    ).toBe("/bookings/bkg_1?from=%2Ftoday%2Fslot_dawn");
  });

  it("falls back for anything that is not one of the portal's screens", () => {
    for (const from of [
      undefined,
      "",
      "https://evil.example/today",
      "//evil.example/today",
      "/\\evil.example",
      "javascript:alert(1)",
      "/sign-in",
      "/payouts",
      "/today/listing",
      "/today/a/b",
      "/bookings/../payouts",
      "/today/ slot",
      `/bookings?q=${"x".repeat(MAX_FROM)}`,
    ]) {
      expect(backFrom(from, BOOKINGS), String(from)).toEqual(BOOKINGS);
    }
  });

  it("reads the first of a repeated parameter", () => {
    expect(backFrom(["/messages", "/today"], BOOKINGS).href).toBe("/messages");
  });

  it("drops a query the place has no use for", () => {
    expect(backFrom("/messages?x=1", BOOKINGS).href).toBe("/messages");
  });
});

describe("handing the way back on", () => {
  it("adds `from`, keeping the link's own query and its fragment last", () => {
    expect(withFrom("/bookings/bkg_1#conversation", "/messages")).toBe(
      "/bookings/bkg_1?from=%2Fmessages#conversation",
    );
    expect(withFrom("/today/slot_1?x=1", "/calendar?week=2026-10-05")).toBe(
      "/today/slot_1?x=1&from=%2Fcalendar%3Fweek%3D2026-10-05",
    );
  });

  it("says a screen's own address with the query it was opened with", () => {
    expect(
      hereWith("/bookings", { view: "upcoming", q: "Asha", from: undefined }),
    ).toBe("/bookings?view=upcoming&q=Asha");
    expect(hereWith("/today/slot_1", {})).toBe("/today/slot_1");
  });

  it("round-trips: what one screen hands on, the next accepts", () => {
    const from = hereWith("/bookings", { view: "past", q: "YV-7K3" });
    const link = withFrom("/bookings/bkg_1", from);
    const handed = new URL(link, "https://x.invalid").searchParams.get("from");
    expect(backFrom(handed ?? undefined, { href: "/", label: "" })).toEqual({
      href: "/bookings?view=past&q=YV-7K3",
      label: "bookings",
    });
  });
});
