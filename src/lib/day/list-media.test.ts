import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  The media list, paged to the end (yuvoy-operator#95 item 2).

  One call was the 50 newest, so past 50 the oldest reels vanished from Home
  and the Reels grid and could be neither published nor withdrawn there.
*/

const get = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: get }),
}));

const { listMedia } = await import("./manifest");

const item = (id: string) => ({ id, kind: "video", state: "published" });

function page(data: Record<string, unknown>) {
  return { data, error: undefined };
}

beforeEach(() => get.mockReset());

describe("reading every reel", () => {
  it("follows nextCursor until the API says it is complete", async () => {
    get
      .mockResolvedValueOnce(
        page({
          items: [item("a"), item("b")],
          complete: false,
          nextCursor: "c1",
        }),
      )
      .mockResolvedValueOnce(page({ items: [item("c")], complete: true }));

    const list = await listMedia("tok");

    expect(list.items.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(list.complete).toBe(true);
    // The second page asks with the cursor the first one handed back.
    expect(get.mock.calls[1][1].params.query).toEqual({
      limit: 200,
      cursor: "c1",
    });
  });

  it("does not stop at a short page that says there is more", async () => {
    get
      .mockResolvedValueOnce(
        page({ items: [item("a")], complete: false, nextCursor: "c1" }),
      )
      .mockResolvedValueOnce(page({ items: [item("b")], complete: true }));

    const list = await listMedia("tok");

    expect(list.items).toHaveLength(2);
  });

  it("keeps what arrived when a later page fails, and says it is partial", async () => {
    get
      .mockResolvedValueOnce(
        page({ items: [item("a")], complete: false, nextCursor: "c1" }),
      )
      .mockResolvedValueOnce({
        data: undefined,
        error: new OperatorApiError({
          code: "internal_error",
          message: "x",
          status: 500,
        }),
      });

    const list = await listMedia("tok");

    expect(list.items.map((m) => m.id)).toEqual(["a"]);
    expect(list.complete).toBe(false);
  });

  it("fails as a whole when the first page does", async () => {
    get.mockResolvedValueOnce({
      data: undefined,
      error: new OperatorApiError({
        code: "internal_error",
        message: "x",
        status: 500,
      }),
    });

    await expect(listMedia("tok")).rejects.toBeInstanceOf(OperatorApiError);
  });

  it("reads an older API, with no paging fields, as one complete page", async () => {
    get.mockResolvedValueOnce(page({ items: [item("a"), item("b")] }));

    const list = await listMedia("tok");

    expect(list).toEqual({ items: [item("a"), item("b")], complete: true });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
