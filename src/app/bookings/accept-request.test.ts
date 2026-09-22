import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  Accepting a seat request, as the API answers it since yuvoy-api#203
  (yuvoy-operator#95 item 1, #90).
*/

const post = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/format/market-time", async (original) => ({
  ...(await original<typeof import("@/lib/format/market-time")>()),
  // 20:00 IST on Mon 21 Sep 2026, so a twelve-hour hold ends tomorrow.
  now: async () => Date.parse("2026-09-21T14:30:00Z"),
}));

const { acceptRequest } = await import("./actions");

function form(timezone = "Asia/Kolkata"): FormData {
  const f = new FormData();
  f.set("requestId", "req_1");
  f.set("timezone", timezone);
  return f;
}

function answered(data: Record<string, unknown>) {
  post.mockResolvedValue({ data, error: undefined });
}

beforeEach(() => post.mockReset());

describe("accepting a request: yuvoy-operator#95", () => {
  it("carries the API's own sentence, capitalised and dedashed", async () => {
    answered({
      id: "req_1",
      state: "active",
      holdExpiresAt: "2026-09-22T02:30:00Z",
      toldBy: ["email"],
      receipt:
        "they are holding 3 seats and still have to pay \u2014 by email. If they have not paid by 08:00 on Tue 22 Sep, the seats come back to you.",
    });

    const state = await acceptRequest({}, form());

    expect(state.granted).toBe(true);
    expect(state.receipt).toMatch(/^They are holding 3 seats/);
    expect(state.receipt).not.toMatch(/[\u2013\u2014\u2015]/);
    expect(state.untold).toBeUndefined();
  });

  it("works out a pay-by time with its day when the API sends no sentence", async () => {
    answered({
      id: "req_1",
      state: "active",
      holdExpiresAt: "2026-09-22T02:30:00Z",
    });

    const state = await acceptRequest({}, form());

    expect(state.receipt).toBeUndefined();
    expect(state.payBy).toBe("08:00 on Tue 22 Sep");
  });

  it("says a bare time when the hold ends today", async () => {
    answered({
      id: "req_1",
      state: "active",
      holdExpiresAt: "2026-09-21T17:40:00Z",
    });

    const state = await acceptRequest({}, form());

    expect(state.payBy).toBe("23:10");
  });

  it("marks a traveller nothing could reach, and only when toldBy is empty", async () => {
    answered({
      id: "req_1",
      state: "active",
      holdExpiresAt: "2026-09-22T02:30:00Z",
      toldBy: [],
    });
    expect((await acceptRequest({}, form())).untold).toBe(true);

    // An older API sends no toldBy at all. That is not "nobody was told".
    answered({
      id: "req_1",
      state: "active",
      holdExpiresAt: "2026-09-22T02:30:00Z",
    });
    expect((await acceptRequest({}, form())).untold).toBeUndefined();
  });

  it("names counter sales when they are what fills the boat (op#90)", async () => {
    post.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "grant_ceiling_exceeded",
        message:
          "the seats you sold at the counter have used up what this departure can grant, so nobody else can be accepted onto it. If that count is wrong, correct it on the counter sales screen and try again",
        status: 409,
      }),
    });

    const state = await acceptRequest({}, form());

    expect(state.message).toMatch(/^The seats you sold at the counter/);
    expect(state.message).toMatch(/Nothing was granted\.$/);
    expect(state.message).not.toMatch(/No signal/);
  });
});
