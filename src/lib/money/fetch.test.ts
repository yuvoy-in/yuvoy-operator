import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  The weekly commission statements (yuvoy-operator#121). What is owed is a sum
  over every statement, so the read pages to the end, and a list it could not
  finish is reported as unfinished rather than as all there is.
*/

const get = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: get }),
}));

const {
  getCommissionStatement,
  getCommissionStatements,
  readCommissionStatements,
} = await import("./fetch");

const PAY_TO = {
  available: true,
  upiId: "yuvoy.dev@example",
  payee: "Yuvoy (dev)",
};

const page = (
  ids: string[],
  more: { complete?: boolean; nextCursor?: string | null } = {},
) => ({
  data: {
    items: ids.map((id) => ({ id })),
    complete: more.complete ?? true,
    nextCursor: more.nextCursor ?? null,
    payTo: PAY_TO,
  },
  error: undefined,
});

beforeEach(() => {
  get.mockReset();
});

describe("every commission statement", () => {
  it("is one read when one page holds them all", async () => {
    get.mockResolvedValueOnce(page(["cst_1", "cst_2"]));
    expect(await getCommissionStatements("tok")).toEqual({
      items: [{ id: "cst_1" }, { id: "cst_2" }],
      complete: true,
      payTo: PAY_TO,
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/commission-statements", {
      params: { query: { limit: 200 } },
    });
  });

  it("follows the cursor to the end, told rather than inferred", async () => {
    get
      .mockResolvedValueOnce(
        page(["cst_1"], { complete: false, nextCursor: "c1" }),
      )
      .mockResolvedValueOnce(page(["cst_2"]));
    const read = await getCommissionStatements("tok");
    expect(read.items.map((s) => s.id)).toEqual(["cst_1", "cst_2"]);
    expect(read.complete).toBe(true);
    expect(get).toHaveBeenLastCalledWith("/commission-statements", {
      params: { query: { limit: 200, cursor: "c1" } },
    });
  });

  it("is unfinished when a page says there is more and gives no way to it", async () => {
    get.mockResolvedValueOnce(
      page(["cst_1"], { complete: false, nextCursor: null }),
    );
    const read = await getCommissionStatements("tok");
    expect(read.complete).toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("stops after ten pages, and says the list is unfinished", async () => {
    get.mockResolvedValue(page(["cst"], { complete: false, nextCursor: "c" }));
    const read = await getCommissionStatements("tok");
    expect(get).toHaveBeenCalledTimes(10);
    expect(read.items).toHaveLength(10);
    expect(read.complete).toBe(false);
  });

  it("offers nowhere to pay when the answer named nowhere", async () => {
    get.mockResolvedValueOnce({
      data: { items: [], complete: true, nextCursor: null },
      error: undefined,
    });
    expect((await getCommissionStatements("tok")).payTo).toEqual({
      available: false,
    });
  });

  it("throws on a refusal, which the soft read turns into unknown", async () => {
    const refusal = new Error("403");
    get.mockResolvedValue({ data: undefined, error: refusal });
    await expect(getCommissionStatements("tok")).rejects.toBe(refusal);
    expect(await readCommissionStatements("tok")).toBeNull();
  });
});

describe("one commission statement", () => {
  it("is read by its id", async () => {
    get.mockResolvedValueOnce({ data: { id: "cst_1" }, error: undefined });
    expect(await getCommissionStatement("tok", "cst_1")).toEqual({
      id: "cst_1",
    });
    expect(get).toHaveBeenCalledWith("/commission-statements/{id}", {
      params: { path: { id: "cst_1" } },
    });
  });
});
