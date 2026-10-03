import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  `listListings` is what Business's tiles read (operator A, approved 3 Oct
  2026): a draft says what it is missing and a selling listing its price. Each
  field is carried only in the shape the contract promises, so an older or
  odd response reads as "not said", never as "nothing missing" or "₹0".
*/

const get = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: get }),
}));

const { listListings } = await import("./manifest");

beforeEach(() => get.mockReset());

function answers(experiences: unknown[]) {
  get.mockResolvedValue({ data: { experiences }, error: undefined });
}

describe("the listings Business reads", () => {
  it("carries what a tile says: the blockers, the price and its basis", async () => {
    answers([
      {
        id: "exp_boat",
        title: "Island boat day",
        status: "draft",
        publicationState: "draft",
        publishBlockers: ["summary", "unitPricePaise"],
        unitPricePaise: null,
        sellable: false,
      },
      {
        id: "exp_dive",
        title: "Reef dive",
        status: "live",
        publicationState: "published",
        publishBlockers: [],
        unitPricePaise: 450_000,
        pricingUnit: "per_person",
      },
    ]);

    const [boat, dive] = (await listListings("tok"))!;

    expect(boat).toEqual({
      id: "exp_boat",
      title: "Island boat day",
      status: "draft",
      sellable: false,
      publicationState: "draft",
      publishBlockers: ["summary", "unitPricePaise"],
    });
    expect(dive).toMatchObject({
      publicationState: "published",
      publishBlockers: [],
      unitPricePaise: 450_000,
      pricingUnit: "per_person",
    });
  });

  it("leaves out a field the API did not send in its own shape", async () => {
    answers([
      {
        id: "exp_odd",
        title: "Odd one",
        publishBlockers: "summary",
        unitPricePaise: 12.5,
      },
      { id: "exp_bare", title: "Bare one" },
    ]);

    const [bare, odd] = (await listListings("tok"))!;

    expect(odd).toEqual({ id: "exp_odd", title: "Odd one" });
    expect(bare).toEqual({ id: "exp_bare", title: "Bare one" });
  });

  it("says the read failed rather than that there are none", async () => {
    // Resolved with an error, as `openapi-fetch` answers a refusal: a mock
    // that rejects is reported as a failure even when the read catches it.
    get.mockResolvedValue({ data: undefined, error: new Error("refused") });
    expect(await listListings("tok")).toBeNull();
  });
});
