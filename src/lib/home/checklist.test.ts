import { describe, expect, it } from "vitest";
import type { Standing } from "@/lib/account/standing";
import type { HomeListing } from "./listings";
import { isNewOperator, startSelling, stepsLeft } from "./checklist";

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
describe("who is new: nobody has ever bought", () => {
  const input = (
    over: Partial<Parameters<typeof isNewOperator>[0]> = {},
  ): Parameters<typeof isNewOperator>[0] => ({
    listings: [draft()],
    peopleOnDaysRead: false,
    everBooked: 0,
    ...over,
  });

  it("is a business that has never been booked, whatever its listings are", () => {
    expect(isNewOperator(input({ listings: [] }))).toBe(true);
    expect(isNewOperator(input())).toBe(true);
    // Live with nothing sold: "until the first sale", not the first publication.
    expect(
      isNewOperator(
        input({
          listings: [draft({ status: "live", publicationState: "published" })],
        }),
      ),
    ).toBe(true);
    // Paused or not selling before anybody bought: still starting.
    expect(
      isNewOperator(
        input({
          listings: [
            draft({ status: "withdrawn", publicationState: "withdrawn" }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("is not a business that has sold, paused for the season or not", () => {
    expect(
      isNewOperator(
        input({
          everBooked: 40,
          listings: [
            draft({ status: "withdrawn", publicationState: "withdrawn" }),
          ],
        }),
      ),
    ).toBe(false);
    // A booking that was later cancelled was still a sale.
    expect(isNewOperator(input({ everBooked: 1 }))).toBe(false);
  });

  it("is not a business somebody is on a departure with, at the counter or not", () => {
    expect(isNewOperator(input({ peopleOnDaysRead: true }))).toBe(false);
  });

  it("is nobody when a read it needs failed", () => {
    expect(isNewOperator(input({ listings: null }))).toBe(false);
    expect(isNewOperator(input({ everBooked: null }))).toBe(false);
  });
});

describe("when the checklist gives way", () => {
  it("stays while a step is left, and goes once every step is done", () => {
    const steps = (done: boolean[]) =>
      done.map((d, i) => ({ key: "details" as const, label: `${i}`, done: d }));
    expect(stepsLeft(steps([true, true, false]))).toBe(true);
    expect(stepsLeft(steps([true, true, true]))).toBe(false);
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
