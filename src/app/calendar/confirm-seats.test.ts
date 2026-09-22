import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  Confirming the seats on many departures at once (yuvoy-operator#94 item 2).
*/

const post = vi.fn();
const revalidatePath = vi.fn();
let canManage = true;

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));
vi.mock("@/lib/format/market-time", async (original) => ({
  ...(await original<typeof import("@/lib/format/market-time")>()),
  marketDays: async () => ({ today: "2026-09-22", tomorrow: "2026-09-23" }),
}));

const { confirmSeats } = await import("./actions");

function form(experienceId?: string): FormData {
  const f = new FormData();
  if (experienceId) f.set("experienceId", experienceId);
  return f;
}

beforeEach(() => {
  post.mockReset();
  revalidatePath.mockReset();
  canManage = true;
});

describe("confirming seats", () => {
  it("asks for the market's today and the thirty days after it, for one listing", async () => {
    post.mockResolvedValue({ data: { confirmed: 3 }, error: undefined });

    const state = await confirmSeats({}, form("exp_1"));

    expect(state).toEqual({ confirmed: 3 });
    expect(post.mock.calls[0][1].body).toEqual({
      from: "2026-09-22",
      to: "2026-10-22",
      experienceId: "exp_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/today/listing/exp_1");
  });

  it("asks for every listing when none is named", async () => {
    post.mockResolvedValue({ data: { confirmed: 0 }, error: undefined });

    const state = await confirmSeats({}, form());

    expect(state).toEqual({ confirmed: 0 });
    expect(post.mock.calls[0][1].body).not.toHaveProperty("experienceId");
  });

  it("refuses a staff login before the request", async () => {
    canManage = false;

    const state = await confirmSeats({}, form("exp_1"));

    expect(state.message).toMatch(/Only owners, admins and managers/);
    expect(post).not.toHaveBeenCalled();
  });

  it("says a suspended account is suspended", async () => {
    post.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "account_suspended",
        message: "your account is suspended",
        status: 403,
      }),
    });

    const state = await confirmSeats({}, form());

    expect(state.message).toBe("Your account is suspended.");
  });

  it("says a listing that is not theirs any more is gone", async () => {
    post.mockResolvedValue({
      data: undefined,
      error: new OperatorApiError({
        code: "not_found",
        message: "x",
        status: 404,
      }),
    });

    const state = await confirmSeats({}, form("exp_gone"));

    expect(state.message).toMatch(/not on this account/);
  });
});
