import { describe, expect, it } from "vitest";
import type { Standing } from "@/lib/account/standing";
import type { HomeListing } from "./listings";
import { isNewOperator, startSelling } from "./checklist";

const PROSPECT: Standing = {
  state: "PROSPECT",
  bookable: false,
  blocking: [
    {
      code: "BUSINESS_DETAILS_INCOMPLETE",
      label: "We still need your registered address",
      waitingOn: "operator",
      gates: true,
    },
    {
      code: "CREDENTIAL_MISSING",
      label: "We still need your insurance certificate",
      waitingOn: "operator",
      gates: true,
    },
  ],
  credentials: [],
  requiredDocuments: [],
};

const draft = (over: Partial<HomeListing> = {}): HomeListing => ({
  id: "exp_1",
  title: "Island boat day",
  status: "draft",
  publicationState: "draft",
  sentBack: false,
  upcomingDepartures: 0,
  ...over,
});

/*
  yuvoy-operator#96: "New operator, nothing live: a start-selling checklist
  (details, documents, first listing, first departure, first reel) replaces
  blocks 3 to 5 until the first sale."
*/
describe("who is new", () => {
  it("is a business nothing of which has ever been on sale", () => {
    expect(isNewOperator([], false)).toBe(true);
    expect(isNewOperator([draft()], false)).toBe(true);
    expect(
      isNewOperator([draft({ publicationState: "in_review" })], false),
    ).toBe(true);
  });

  it("is not a business whose listings are paused for the season", () => {
    expect(
      isNewOperator(
        [draft({ status: "withdrawn", publicationState: "withdrawn" })],
        false,
      ),
    ).toBe(false);
  });

  it("is not a business somebody is booked with", () => {
    expect(isNewOperator([draft()], true)).toBe(false);
  });

  it("is nobody when the listings could not be read", () => {
    expect(isNewOperator(null, false)).toBe(false);
  });
});

describe("the steps", () => {
  it("ticks what is done and opens what is not", () => {
    const steps = startSelling({
      standing: PROSPECT,
      listings: [draft({ upcomingDepartures: 2 })],
      reels: 0,
      canManage: true,
    });
    expect(steps).toEqual([
      {
        key: "details",
        label: "Tell us about your business",
        done: false,
        href: "/profile",
      },
      {
        key: "documents",
        label: "Send your documents",
        done: false,
        href: "/account/verification",
      },
      {
        key: "listing",
        label: "Write your first listing",
        done: true,
        href: "/account/listings/new",
      },
      {
        key: "departure",
        label: "Add your first departure",
        done: true,
        href: "/calendar",
      },
      {
        key: "reel",
        label: "Add your first reel",
        done: false,
        href: "/account?tab=reels",
      },
    ]);
  });

  it("counts documents sent and waiting on Yuvoy as sent", () => {
    const steps = startSelling({
      standing: {
        ...PROSPECT,
        blocking: [
          {
            code: "CREDENTIAL_UNVERIFIED",
            label: "We are checking your insurance certificate",
            waitingOn: "yuvoy",
            gates: true,
          },
        ],
      },
      listings: [],
      reels: 2,
      canManage: true,
    });
    expect(steps.find((s) => s.key === "documents")?.done).toBe(true);
    expect(steps.find((s) => s.key === "details")?.done).toBe(true);
    expect(steps.find((s) => s.key === "reel")?.done).toBe(true);
    expect(steps.find((s) => s.key === "listing")?.done).toBe(false);
  });

  it("links a staff login only to what it may do", () => {
    const steps = startSelling({
      standing: PROSPECT,
      listings: [],
      reels: null,
      canManage: false,
    });
    expect(steps.filter((s) => s.href).map((s) => s.key)).toEqual([
      "documents",
      "reel",
    ]);
  });

  it("does not tick what it cannot see", () => {
    const steps = startSelling({
      standing: null,
      listings: [],
      reels: null,
      canManage: true,
    });
    expect(steps.every((s) => !s.done)).toBe(true);
  });
});
