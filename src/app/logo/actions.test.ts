import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  The logo write, read by its STATUS rather than by its body.

  A LIVE business's `PUT /logo` answers `202 { state: "in_review", next }`: the
  new mark is recorded for review and the old one stays up (D-032.3). The
  contract declares that answer under `GET /logo` (yuvoy-api#222), so
  `openapi-fetch` hands it back as `data` like any 2xx, and the screen used to
  say "Saved. Your mark is on your listings now." about a logo nobody could
  see yet (yuvoy-operator#89 f10).
*/

const put = vi.fn();
const revalidatePath = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ PUT: put, POST: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { saveLogo } = await import("./actions");

function answered(status: number, data: unknown) {
  return { data, error: undefined, response: new Response(null, { status }) };
}

beforeEach(() => {
  put.mockReset();
  revalidatePath.mockReset();
});

describe("saving the logo: yuvoy-operator#89 f10", () => {
  it("reports a 202 as sent for review, never as saved", async () => {
    put.mockResolvedValue(
      answered(202, {
        state: "in_review",
        next: "We look at a new logo before it appears on your reels and listings.",
      }),
    );

    const result = await saveLogo("img_new");

    expect(result).toEqual({ inReview: true });
    expect(result.logoUrl).toBeUndefined();
  });

  it("does not re-render the screens behind the receipt on a 202", async () => {
    /*
      Nothing changed on file: every screen would re-render the mark that is
      still live, which is what they already show.
    */
    put.mockResolvedValue(answered(202, { state: "in_review", next: "…" }));
    await saveLogo("img_new");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reports a 200 as saved, with the new mark, and refreshes both screens", async () => {
    put.mockResolvedValue(answered(200, { logoUrl: "https://img/new" }));

    const result = await saveLogo("img_new");

    expect(result).toEqual({ logoUrl: "https://img/new" });
    expect(result.inReview).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/logo");
    expect(revalidatePath).toHaveBeenCalledWith("/account");
  });

  it("reads an upload the host never got as the file not arriving", async () => {
    put.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "invalid_input",
        message: "that upload has not arrived",
        status: 400,
      }),
      response: new Response(null, { status: 400 }),
    });

    const result = await saveLogo("img_new");

    expect(result.message).toBe("That upload did not finish. Choose it again.");
    expect(result.inReview).toBeUndefined();
  });

  it("sends nothing for an empty id", async () => {
    const result = await saveLogo("");
    expect(result.message).toBe("There is nothing to save.");
    expect(put).not.toHaveBeenCalled();
  });
});
