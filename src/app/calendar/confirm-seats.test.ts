import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";

/*
  Confirming the seats on many departures at once (yuvoy-operator#94 item 2),
  in one call with no dates (yuvoy-api#241, #244). Production runs #244 since
  29 Sep 2026, so the year of 31-day windows that stood in for it is gone.
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

type Body = { from?: string; to?: string; experienceId?: string };
const bodies = () => post.mock.calls.map((call) => call[1].body as Body);

const refused = (status: number, code: string, message: string) => ({
  data: undefined,
  error: new OperatorApiError({ code, message, status }),
});

describe("confirming seats", () => {
  it("confirms everything the listing's counts include, in one call with no dates", async () => {
    post.mockResolvedValue({ data: { confirmed: 19 }, error: undefined });

    const state = await confirmSeats({}, form("exp_1"));

    expect(state).toEqual({ confirmed: 19 });
    // Only the listing: no dates, so nothing it counts is out of reach.
    expect(bodies()).toEqual([{ experienceId: "exp_1" }]);
    expect(revalidatePath).toHaveBeenCalledWith("/today");
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/today/listing/exp_1");
  });

  it("sends an empty body for every listing when none is named", async () => {
    post.mockResolvedValue({ data: { confirmed: 0 }, error: undefined });

    const state = await confirmSeats({}, form());

    // 0 is a real answer: nothing needed it.
    expect(state).toEqual({ confirmed: 0 });
    expect(bodies()).toEqual([{}]);
    expect(revalidatePath).not.toHaveBeenCalledWith(
      expect.stringMatching(/^\/today\/listing\//),
    );
  });

  it("refuses a staff login before the request", async () => {
    canManage = false;

    const state = await confirmSeats({}, form("exp_1"));

    expect(state.message).toMatch(/Only owners, admins and managers/);
    expect(post).not.toHaveBeenCalled();
  });

  it("says a suspended account is suspended", async () => {
    post.mockResolvedValue(
      refused(403, "account_suspended", "your account is suspended"),
    );

    const state = await confirmSeats({}, form());

    expect(state.message).toBe("Your account is suspended.");
    expect(post).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says a listing that is not theirs any more is gone", async () => {
    post.mockResolvedValue(refused(404, "not_found", "x"));

    const state = await confirmSeats({}, form("exp_gone"));

    expect(state.message).toMatch(/not on this account/);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("says nothing was confirmed when there is no signal, and asks nothing else", async () => {
    post.mockRejectedValue(new OperatorNetworkError());

    const state = await confirmSeats({}, form());

    expect(state).toEqual({
      message: "No signal. Nothing was confirmed. Try again.",
    });
    expect(post).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says a refusal in the API's words, once, and never retries it as a range", async () => {
    post.mockResolvedValue(
      refused(400, "invalid_input", "dates look like 2006-01-02"),
    );

    const state = await confirmSeats({}, form());

    expect(state).toEqual({ message: "Dates look like 2006-01-02." });
    expect(post).toHaveBeenCalledTimes(1);
    expect(bodies()[0]).toEqual({});
  });
});
