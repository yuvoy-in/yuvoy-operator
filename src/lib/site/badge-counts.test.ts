import { describe, it, expect } from "vitest";
import { countBadges } from "./badge-counts";
import type { Standing } from "@/lib/account/standing";

const standing = (blocking: Standing["blocking"]): Standing => ({
  state: "LIVE",
  bookable: true,
  blocking,
  credentials: [],
});

describe("the counts on the bar — yuvoy-operator#42", () => {
  it("counts every open request, the queue Bookings renders", () => {
    expect(
      countBadges({ account: null, requests: [{}, {}, {}] }).bookings,
    ).toBe(3);
  });

  it("counts only what is waiting on the OPERATOR, the list Business renders", () => {
    /*
      Something with Yuvoy is not their work queue. A badge counting it would
      send an operator to a screen where the only thing to do is wait.
    */
    const counts = countBadges({
      account: standing([
        {
          code: "CREDENTIAL_MISSING",
          label: "We still need your insurance certificate",
          waitingOn: "operator",
          gates: true,
        },
        {
          code: "LOGO_MISSING",
          label: "We still need your logo",
          waitingOn: "operator",
          gates: false,
        },
        {
          code: "CREDENTIAL_UNVERIFIED",
          label: "We are checking your boat papers",
          waitingOn: "yuvoy",
          gates: true,
        },
      ]),
      requests: [],
    });
    expect(counts.business).toBe(2);
  });

  it("says zero as zero, which draws nothing", () => {
    expect(countBadges({ account: standing([]), requests: [] })).toEqual({
      bookings: 0,
      business: 0,
    });
  });

  it("leaves a count out when its source could not be read, rather than saying zero", () => {
    /*
      Zero and unknown both render as no badge, and only one of them is true —
      so an unreadable source contributes no key at all, and nothing
      downstream can mistake it for a measured empty queue.
    */
    expect(countBadges({ account: null, requests: undefined })).toEqual({});
    expect(
      "bookings" in countBadges({ account: standing([]), requests: undefined }),
    ).toBe(false);
  });
});
