import { describe, expect, it } from "vitest";
import { HOME_PATH, safeReturnPath, signInPathFor } from "./return-to";
import { NAV } from "@/lib/site/nav";

describe("safeReturnPath — what it allows", () => {
  it("takes a path in the portal", () => {
    expect(safeReturnPath("/today")).toBe("/today");
    expect(safeReturnPath("/today/slot_dawn")).toBe("/today/slot_dawn");
    expect(safeReturnPath("/requests")).toBe("/requests");
    expect(safeReturnPath("/account")).toBe("/account");
  });

  it("keeps a query string, which is part of where somebody was", () => {
    expect(safeReturnPath("/today/slot_dawn?filter=held")).toBe(
      "/today/slot_dawn?filter=held",
    );
  });

  it("does not judge the allowlist on the query string", () => {
    // The path decides; the query is carried. Judging the whole string would
    // let `?x=` smuggle something past the prefix check.
    expect(safeReturnPath("/today?x=/../../evil")).toBe("/today?x=/../../evil");
  });
});

describe("safeReturnPath — the open redirect it exists to stop", () => {
  /*
    Every one of these passes `startsWith("/")`, which is the check people
    actually write. Handed to `redirect()` they forward an operator off-site
    immediately after a successful sign-in, from a real Yuvoy URL.
  */
  it("refuses a protocol-relative URL", () => {
    expect(safeReturnPath("//evil.com")).toBeNull();
    expect(safeReturnPath("//evil.com/today")).toBeNull();
  });

  it("refuses a backslash, which browsers read as a slash", () => {
    expect(safeReturnPath("/\\evil.com")).toBeNull();
    expect(safeReturnPath("/\\/evil.com")).toBeNull();
    expect(safeReturnPath("/today\\@evil.com")).toBeNull();
  });

  it("refuses the same tricks wearing an encoding", () => {
    expect(safeReturnPath("/%2f%2fevil.com")).toBeNull();
    expect(safeReturnPath("/%5cevil.com")).toBeNull();
    expect(safeReturnPath("%2f%2fevil.com")).toBeNull();
  });

  it("refuses an absolute URL", () => {
    expect(safeReturnPath("https://evil.com")).toBeNull();
    expect(safeReturnPath("http://evil.com")).toBeNull();
    expect(safeReturnPath("javascript:alert(1)")).toBeNull();
    expect(safeReturnPath("data:text/html,<script>")).toBeNull();
  });

  it("refuses control characters, which split a Location header", () => {
    expect(safeReturnPath("/today\nLocation: https://evil.com")).toBeNull();
    expect(safeReturnPath("/today\r\nSet-Cookie: a=b")).toBeNull();
    expect(safeReturnPath("/\t/evil.com")).toBeNull();
    expect(safeReturnPath("/today\u0000")).toBeNull();
  });

  it("refuses traversal", () => {
    expect(safeReturnPath("/today/../../etc")).toBeNull();
  });

  it("refuses a path that is not one of ours", () => {
    // An allowlist, not a denylist: a route that does not exist is not a
    // place to send anybody, however harmless it looks.
    expect(safeReturnPath("/admin")).toBeNull();
    expect(safeReturnPath("/todayzzz")).toBeNull();
    expect(safeReturnPath("/")).toBeNull();
  });

  it("refuses the doors that would loop", () => {
    // Returning to sign-in after signing in is a loop, and `/join` is not a
    // place to land holding a session.
    expect(safeReturnPath("/sign-in")).toBeNull();
    expect(safeReturnPath("/signup")).toBeNull();
    expect(safeReturnPath("/join")).toBeNull();
  });

  it("refuses nothing at all", () => {
    expect(safeReturnPath(null)).toBeNull();
    expect(safeReturnPath(undefined)).toBeNull();
    expect(safeReturnPath("")).toBeNull();
  });

  it("refuses a malformed encoding rather than guessing at it", () => {
    expect(safeReturnPath("/today/%E0%A4%A")).toBeNull();
  });
});

describe("signInPathFor", () => {
  it("carries a worthwhile destination", () => {
    expect(signInPathFor("/today/slot_dawn")).toBe(
      "/sign-in?next=%2Ftoday%2Fslot_dawn",
    );
  });

  it("adds nothing when the destination is where sign-in lands anyway", () => {
    // A query string that changes nothing is noise in a bookmark and one more
    // thing to be wrong.
    expect(signInPathFor(HOME_PATH)).toBe("/sign-in");
  });

  it("adds nothing for a destination it would refuse", () => {
    expect(signInPathFor("//evil.com")).toBe("/sign-in");
    expect(signInPathFor(null)).toBe("/sign-in");
  });

  it("encodes, so the query cannot be broken out of", () => {
    const built = signInPathFor("/today/slot_dawn?filter=held");
    expect(built).toBe("/sign-in?next=%2Ftoday%2Fslot_dawn%3Ffilter%3Dheld");
    // And round-trips back to exactly what went in.
    const returned = new URLSearchParams(built.split("?")[1]).get("next");
    expect(safeReturnPath(returned)).toBe("/today/slot_dawn?filter=held");
  });
});

/**
 * The allowlist is derived, not written down — yuvoy-operator#32.
 *
 * It was a literal list and it went stale twice, silently and in the worst
 * direction: a bounced operator lost the page they were on and landed on
 * Today, which is the exact failure `?next=` exists to prevent. When two tabs
 * were renamed the list still said `/reels` and had never learned `/profile`.
 */
describe("every destination is returnable by construction", () => {
  it("covers every stop in the navigation bar", () => {
    for (const item of NAV) {
      expect(safeReturnPath(item.href), `${item.href} is not returnable`).toBe(
        item.href,
      );
    }
  });

  it("covers every focused screen behind a stop", () => {
    for (const path of [
      "/profile",
      "/logo",
      "/earnings",
      "/payouts",
      "/team",
    ]) {
      expect(safeReturnPath(path), `${path} is not returnable`).toBe(path);
    }
  });

  it("still returns to the two renamed URLs", () => {
    // 308s, not deletions. Somebody bounced off an old bookmark should land
    // back on it and be forwarded, not lose their place.
    expect(safeReturnPath("/requests")).toBe("/requests");
    expect(safeReturnPath("/capacity")).toBe("/capacity");
  });

  it("still refuses the doors that would loop", () => {
    for (const path of ["/sign-in", "/signup", "/join", "/join/abc"]) {
      expect(safeReturnPath(path), `${path} must not be returnable`).toBeNull();
    }
  });
});
