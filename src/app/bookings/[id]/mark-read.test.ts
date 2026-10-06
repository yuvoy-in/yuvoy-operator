import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  The unread count catches up once a conversation is read (the stability
  audit, P2-5).

  The count beside the inbox is drawn by the root layout, which a soft
  navigation does not re-render, and the marker re-read nothing: the badge
  went on saying a message was unread after it had been read.
*/

const post = vi.fn();
const refresh = vi.fn();

vi.mock("next/cache", () => ({ refresh: () => refresh() }));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));

const { markThreadRead } = await import("./conversation-actions");

beforeEach(() => {
  post.mockReset();
  refresh.mockReset();
});

describe("marking a conversation read", () => {
  it("moves the marker, and the same answer re-reads the screen", async () => {
    post.mockResolvedValue({ data: {}, error: undefined });
    await markThreadRead("bkg_1", "m2");

    expect(post.mock.calls[0][1]).toEqual({
      params: { path: { id: "bkg_1" } },
      body: { upTo: "m2" },
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("re-reads nothing when the marker did not move", async () => {
    post.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "not_found",
        message: "Not found",
        status: 404,
      }),
    });
    await expect(markThreadRead("bkg_1", "m2")).resolves.toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });
});
