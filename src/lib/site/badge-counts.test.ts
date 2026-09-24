import { describe, it, expect } from "vitest";
import { countBadges } from "./badge-counts";
import type { Standing } from "@/lib/account/standing";

const standing = (
  blocking: Standing["blocking"],
  bookable = true,
): Standing => ({
  state: bookable ? "LIVE" : "PROSPECT",
  bookable,
  blocking,
  credentials: [],
  requiredDocuments: [],
});

const INSURANCE = {
  code: "CREDENTIAL_MISSING",
  label: "We still need your insurance certificate",
  waitingOn: "operator",
  gates: true,
} as const;
const LOGO = {
  code: "LOGO_MISSING",
  label: "We still need your logo",
  waitingOn: "operator",
  gates: false,
} as const;
const CHECKING = {
  code: "CREDENTIAL_UNVERIFIED",
  label: "We are checking your boat papers",
  waitingOn: "yuvoy",
  gates: true,
} as const;

describe("the counts on the bar: yuvoy-operator#42, #96", () => {
  it("counts every open request, the queue Bookings renders", () => {
    expect(
      countBadges({ account: null, canManage: true, requests: [{}, {}, {}] })
        .bookings,
    ).toBe(3);
  });

  it("counts only what stops the business selling, and is the operator's", () => {
    /*
      #96 item 6: "The Business badge reads '2' (two non-blocking
      verification items)" does not scan. Something with Yuvoy is not their
      work queue either.
    */
    const counts = countBadges({
      account: standing([INSURANCE, LOGO, CHECKING], false),
      canManage: true,
      requests: [],
    });
    expect(counts.business).toBe(1);
  });

  it("draws nothing for items outstanding on a business that is selling", () => {
    expect(
      countBadges({
        account: standing([LOGO, { ...INSURANCE, gates: false }]),
        canManage: true,
        requests: [],
      }).business,
    ).toBe(0);
  });

  it("counts a blocker that will not say whether it stops a sale", () => {
    const unsure = { ...LOGO, gates: undefined } as unknown as typeof LOGO;
    expect(
      countBadges({
        account: standing([unsure], false),
        canManage: true,
        requests: [],
      }).business,
    ).toBe(1);
  });

  it("counts for a staff login only what staff can do", () => {
    // A document is theirs to send; the logo is an owner's, admin's or manager's.
    const account = standing([INSURANCE, { ...LOGO, gates: true }], false);
    expect(
      countBadges({ account, canManage: false, requests: [] }).business,
    ).toBe(1);
    expect(
      countBadges({ account, canManage: true, requests: [] }).business,
    ).toBe(2);
  });

  it("says zero as zero, which draws nothing", () => {
    expect(
      countBadges({ account: standing([]), canManage: true, requests: [] }),
    ).toEqual({
      bookings: 0,
      business: 0,
    });
  });

  it("leaves a count out when its source could not be read, rather than saying zero", () => {
    /*
      Zero and unknown both render as no badge, and only one of them is true:
      so an unreadable source contributes no key at all, and nothing
      downstream can mistake it for a measured empty queue.
    */
    expect(
      countBadges({ account: null, canManage: false, requests: undefined }),
    ).toEqual({});
    expect(
      "bookings" in
        countBadges({
          account: standing([]),
          canManage: true,
          requests: undefined,
        }),
    ).toBe(false);
  });
});
