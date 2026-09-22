import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  A counter sale refused because the business is suspended (yuvoy-operator#90
  f13). It read "Not recorded. Try again.", a retry that can never succeed
  with the one fact that explains it hidden.
*/

const post = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { recordOfflineSale } = await import("./actions");

function form(): FormData {
  const f = new FormData();
  f.set("slotId", "slot_1");
  f.set("seats", "2");
  f.set("note", "");
  return f;
}

beforeEach(() => post.mockReset());

describe("recording a counter sale", () => {
  it("says the account is suspended, in the API's words", async () => {
    post.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "account_suspended",
        message: "your account is suspended while we review a complaint",
        status: 403,
      }),
    });

    const state = await recordOfflineSale({}, form());

    expect(state.message).toBe(
      "Your account is suspended while we review a complaint.",
    );
  });

  it("still says what it recorded when it works", async () => {
    post.mockResolvedValue({
      data: { seatsRecorded: 2, seatsRemaining: 4, totalSoldOffline: 2 },
      error: undefined,
    });

    const state = await recordOfflineSale({}, form());

    expect(state.result).toEqual({
      seatsRecorded: 2,
      seatsRemaining: 4,
      totalSoldOffline: 2,
    });
  });
});
