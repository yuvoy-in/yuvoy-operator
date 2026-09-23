import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OperatorSlot } from "@/lib/day/types";

/*
  Home's own reads (yuvoy-operator#96): every one fails soft and on its own,
  none is asked per listing, and no figure is invented from silence.

  These are the promises the page comment makes and the ones a screen cannot
  prove about itself: a listings call that failed must answer `null` rather
  than an empty catalogue, a departure whose manifest did not load must cost
  that row alone, a staff-refused money read must never become "₹0", and an
  API that sends no unrecorded count must not be read as "none".
*/

const get = vi.fn();
const getManifest = vi.fn();
const listMedia = vi.fn();
const getCommissionOwed = vi.fn();
const getSettlementOverview = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: get }),
}));
vi.mock("@/lib/day/manifest", () => ({
  getManifest: (...args: unknown[]) => getManifest(...args),
  listMedia: (...args: unknown[]) => listMedia(...args),
}));
vi.mock("@/lib/money/fetch", () => ({
  getCommissionOwed: (...args: unknown[]) => getCommissionOwed(...args),
  getSettlementOverview: (...args: unknown[]) => getSettlementOverview(...args),
}));

const { readHomeListings, readManifests, readMoneyToday, readReelCount } =
  await import("./fetch");

beforeEach(() => {
  get.mockReset();
  getManifest.mockReset();
  listMedia.mockReset();
  getCommissionOwed.mockReset();
  getSettlementOverview.mockReset();
});

const slot = (over: Partial<OperatorSlot> = {}): OperatorSlot => ({
  id: "slot_1",
  title: "Dawn dive",
  startsAt: "2026-09-22T01:15:00Z",
  timezone: "Asia/Kolkata",
  seats: 8,
  sold: 3,
  remaining: 5,
  status: "open",
  ...over,
});

const WEEK = {
  periodStart: "2026-09-14",
  periodEnd: "2026-09-20",
  settlesFrom: "2026-09-21",
  netPaise: 4_015_000,
};

describe("the listings Home counts", () => {
  it("is one read for every listing, never one per listing", async () => {
    get.mockResolvedValue({
      data: {
        experiences: [
          { id: "exp_1", title: "Dawn dive", status: "live" },
          { id: "exp_2", title: "Sunset cruise", status: "draft" },
        ],
      },
    });
    const listings = await readHomeListings("tok");
    expect(listings).toHaveLength(2);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get.mock.calls[0][0]).toBe("/experiences");
  });

  it("is null when the read did not answer, never an empty catalogue", async () => {
    get.mockResolvedValue({ error: { code: "internal_error" } });
    expect(await readHomeListings("tok")).toBeNull();

    get.mockRejectedValue(new Error("no signal"));
    expect(await readHomeListings("tok")).toBeNull();
  });

  it("drops a row with no id, which nothing could point at", async () => {
    get.mockResolvedValue({
      data: { experiences: [{ title: "Nameless" }, { id: "exp_2" }] },
    });
    expect((await readHomeListings("tok"))?.map((l) => l.id)).toEqual([
      "exp_2",
    ]);
  });
});

describe("the manifests of today's departures", () => {
  it("asks only for the departures somebody could be on", async () => {
    getManifest.mockResolvedValue({ parties: [] });
    await readManifests("tok", [
      slot({ id: "has_people", sold: 2 }),
      slot({ id: "nobody", sold: 0 }),
      slot({ id: "called_off", sold: 4, status: "cancelled" }),
    ]);
    expect(getManifest.mock.calls.map((c) => c[1])).toEqual(["has_people"]);
  });

  it("costs one row its detail when it fails, and never the rest", async () => {
    getManifest.mockImplementation((_token: string, id: string) =>
      id === "bad"
        ? Promise.reject(new Error("500"))
        : Promise.resolve({ parties: [{ bookingId: "b" }] }),
    );
    const read = await readManifests("tok", [
      slot({ id: "bad" }),
      slot({ id: "good" }),
    ]);
    expect(read.get("bad")).toBeNull();
    expect(read.get("good")).toEqual({ parties: [{ bookingId: "b" }] });
  });
});

describe("money today", () => {
  it("carries the week, what is owed on cash, and the unrecorded count", async () => {
    getSettlementOverview.mockResolvedValue({ nextSettlement: WEEK });
    getCommissionOwed.mockResolvedValue({
      commissionPaise: 450_000,
      unrecorded: { bookings: 3, farePaise: 900_000, lines: [] },
    });
    expect(await readMoneyToday("tok")).toEqual({
      week: WEEK,
      owedPaise: 450_000,
      unrecorded: 3,
    });
  });

  it("keeps each half when the other did not answer", async () => {
    getSettlementOverview.mockRejectedValue(new Error("500"));
    getCommissionOwed.mockResolvedValue({
      commissionPaise: 0,
      unrecorded: null,
    });
    expect(await readMoneyToday("tok")).toEqual({
      week: null,
      owedPaise: 0,
      unrecorded: null,
    });

    getSettlementOverview.mockResolvedValue({ nextSettlement: WEEK });
    getCommissionOwed.mockRejectedValue(new Error("403"));
    expect(await readMoneyToday("tok")).toEqual({
      week: WEEK,
      owedPaise: null,
      unrecorded: null,
    });
  });

  it("is every figure unknown when both reads were refused", async () => {
    getSettlementOverview.mockRejectedValue(new Error("403"));
    getCommissionOwed.mockRejectedValue(new Error("403"));
    expect(await readMoneyToday("tok")).toEqual({
      week: null,
      owedPaise: null,
      unrecorded: null,
    });
  });

  it("reads no week from a settlement missing a field it is written from", async () => {
    getCommissionOwed.mockResolvedValue({ commissionPaise: 0 });
    for (const missing of [
      "periodStart",
      "periodEnd",
      "settlesFrom",
      "netPaise",
    ] as const) {
      getSettlementOverview.mockResolvedValue({
        nextSettlement: { ...WEEK, [missing]: undefined },
      });
      const money = await readMoneyToday("tok");
      expect(money.week, `${missing} absent`).toBeNull();
    }
  });

  it("takes the overview's unrecorded count only when commission-owed sent none", async () => {
    getSettlementOverview.mockResolvedValue({
      nextSettlement: WEEK,
      paidAtCounter: { unrecordedBookings: 7 },
    });
    getCommissionOwed.mockResolvedValue({
      commissionPaise: 0,
      unrecorded: null,
    });
    expect((await readMoneyToday("tok")).unrecorded).toBe(7);

    // And commission-owed wins where both said, including at zero.
    getCommissionOwed.mockResolvedValue({
      commissionPaise: 0,
      unrecorded: { bookings: 0, farePaise: 0, lines: [] },
    });
    expect((await readMoneyToday("tok")).unrecorded).toBe(0);
  });

  it("is unknown rather than none when neither read sent the count", async () => {
    /*
      "0 unrecorded" from an API that never said is a claim: it tells an
      operator with seven trips nobody recorded that there is nothing to close.
    */
    getSettlementOverview.mockResolvedValue({
      nextSettlement: WEEK,
      paidAtCounter: {},
    });
    getCommissionOwed.mockResolvedValue({
      commissionPaise: 0,
      unrecorded: null,
    });
    expect((await readMoneyToday("tok")).unrecorded).toBeNull();
  });
});

describe("the reels the checklist counts", () => {
  it("counts clips by what the API calls them, never a photograph", async () => {
    listMedia.mockResolvedValue({
      items: [
        { id: "m1", kind: "video" },
        { id: "m2", kind: "image" },
        { id: "m3", kind: "video" },
        { id: "m4" },
      ],
      complete: true,
    });
    expect(await readReelCount("tok")).toBe(2);
  });

  it("is unknown when the read failed, so the step is not ticked from silence", async () => {
    listMedia.mockRejectedValue(new Error("500"));
    expect(await readReelCount("tok")).toBeNull();
  });
});
