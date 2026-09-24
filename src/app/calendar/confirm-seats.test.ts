import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";

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

type Body = { from: string; to: string; experienceId?: string };
const bodies = () => post.mock.calls.map((call) => call[1].body as Body);
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

describe("confirming seats", () => {
  it("asks for a year from the market's today, in windows of 31 days, for one listing", async () => {
    post.mockResolvedValue({ data: { confirmed: 1 }, error: undefined });

    const state = await confirmSeats({}, form("exp_1"));

    // Every window's answer is added up.
    expect(state).toEqual({ confirmed: 12 });
    const sent = bodies();
    expect(sent).toHaveLength(12);
    expect(sent[0]).toEqual({
      from: "2026-09-22",
      to: "2026-10-22",
      experienceId: "exp_1",
    });
    sent.forEach((body, i) => {
      // 31 days, both ends included: the most one call may ask for.
      expect((dayMs(body.to) - dayMs(body.from)) / 86_400_000).toBe(30);
      expect(body.experienceId).toBe("exp_1");
      // End to end: no day asked twice, no day missed.
      if (i > 0) {
        expect((dayMs(body.from) - dayMs(sent[i - 1].to)) / 86_400_000).toBe(1);
      }
    });
    // A year and a week, never short of twelve months.
    expect(sent[11].to).toBe("2027-09-28");
    expect(revalidatePath).toHaveBeenCalledWith("/today/listing/exp_1");
  });

  it("asks for every listing when none is named", async () => {
    post.mockResolvedValue({ data: { confirmed: 0 }, error: undefined });

    const state = await confirmSeats({}, form());

    expect(state).toEqual({ confirmed: 0 });
    for (const body of bodies())
      expect(body).not.toHaveProperty("experienceId");
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
    expect(revalidatePath).not.toHaveBeenCalled();
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

  it("says nothing was confirmed when there is no signal", async () => {
    post.mockRejectedValue(new OperatorNetworkError());

    const state = await confirmSeats({}, form());

    expect(state).toEqual({
      message: "No signal. Nothing was confirmed. Try again.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says what it did confirm when some dates did not answer", async () => {
    post.mockImplementation(async (_path: string, { body }: { body: Body }) =>
      body.from === "2027-01-24"
        ? Promise.reject(new OperatorNetworkError())
        : { data: { confirmed: 2 }, error: undefined },
    );

    const state = await confirmSeats({}, form());

    // Eleven windows answered, two each. Never a receipt: the row stays, so
    // the operator can finish what did not answer.
    expect(state).toEqual({
      message:
        "Seats confirmed on 22 departures. Some dates did not answer. Try again.",
    });
    expect(state.confirmed).toBeUndefined();
    // What did change is re-read.
    expect(revalidatePath).toHaveBeenCalledWith("/today");
  });

  it("claims nothing when the dates that answered had nothing to confirm", async () => {
    let calls = 0;
    post.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new OperatorNetworkError();
      return { data: { confirmed: 0 }, error: undefined };
    });

    const state = await confirmSeats({}, form());

    expect(state).toEqual({ message: "Some dates did not answer. Try again." });
  });
});
