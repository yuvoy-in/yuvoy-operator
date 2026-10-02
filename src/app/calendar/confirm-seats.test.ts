import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";

/*
  Confirming the seats on many departures at once (yuvoy-operator#94 item 2),
  in one call with no dates (yuvoy-api#241, #244), and the year of 31-day
  windows it falls back to against an API from before #244.
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

type Body = { from?: string; to?: string; experienceId?: string };
const bodies = () => post.mock.calls.map((call) => call[1].body as Body);
const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

const refused = (status: number, code: string, message: string) => ({
  data: undefined,
  error: new OperatorApiError({ code, message, status }),
});

/*
  What an API from before #244 answers `{}`: the empty dates reach a date
  parse, and the handler refuses them as a range it cannot read.
*/
const OLD_API = refused(400, "invalid_input", "dates look like 2006-01-02");

/** Answers a call with no dates as an older API does, and a range with `n`. */
function olderApi(n: number) {
  return async (_path: string, { body }: { body: Body }) =>
    body.from === undefined ? OLD_API : { data: { confirmed: n } };
}

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
    // A dropped connection is not an older API: no sweep behind it.
    expect(post).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reads only invalid_input as an older API, never another 400", async () => {
    post.mockResolvedValue(
      refused(400, "unclassified_error", "something about that request"),
    );

    const state = await confirmSeats({}, form());

    expect(state).toEqual({ message: "Something about that request." });
    expect(post).toHaveBeenCalledTimes(1);
  });
});

/*
  THE FALLBACK. Delete this block with `confirmSeatsByWindows` once production
  is confirmed on yuvoy-api #244 or later.
*/
describe("confirming seats against an API from before #244", () => {
  it("sweeps a year from the market's today, in windows of 31 days, for one listing", async () => {
    post.mockImplementation(olderApi(1));

    const state = await confirmSeats({}, form("exp_1"));

    // Every window's answer is added up.
    expect(state).toEqual({ confirmed: 12 });
    const [first, ...windows] = bodies();
    // The call with no dates went first, and was refused.
    expect(first).toEqual({ experienceId: "exp_1" });
    expect(windows).toHaveLength(12);
    expect(windows[0]).toEqual({
      from: "2026-09-22",
      to: "2026-10-22",
      experienceId: "exp_1",
    });
    windows.forEach((body, i) => {
      // 31 days, both ends included: the most one call may ask for.
      expect((dayMs(body.to!) - dayMs(body.from!)) / 86_400_000).toBe(30);
      expect(body.experienceId).toBe("exp_1");
      // End to end: no day asked twice, no day missed.
      if (i > 0) {
        expect(
          (dayMs(body.from!) - dayMs(windows[i - 1].to!)) / 86_400_000,
        ).toBe(1);
      }
    });
    // A year and a week, never short of twelve months.
    expect(windows[11].to).toBe("2027-09-28");
    expect(revalidatePath).toHaveBeenCalledWith("/today/listing/exp_1");
  });

  it("sweeps every listing when none is named", async () => {
    post.mockImplementation(olderApi(0));

    const state = await confirmSeats({}, form());

    expect(state).toEqual({ confirmed: 0 });
    for (const body of bodies())
      expect(body).not.toHaveProperty("experienceId");
  });

  it("says what it did confirm when some dates did not answer", async () => {
    post.mockImplementation(async (_path: string, { body }: { body: Body }) => {
      if (body.from === undefined) return OLD_API;
      if (body.from === "2027-01-24") throw new OperatorNetworkError();
      return { data: { confirmed: 2 }, error: undefined };
    });

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
    let windows = 0;
    post.mockImplementation(async (_path: string, { body }: { body: Body }) => {
      if (body.from === undefined) return OLD_API;
      windows += 1;
      if (windows === 1) throw new OperatorNetworkError();
      return { data: { confirmed: 0 }, error: undefined };
    });

    const state = await confirmSeats({}, form());

    expect(state).toEqual({ message: "Some dates did not answer. Try again." });
  });

  it("says why when no window answers at all", async () => {
    post.mockImplementation(async (_path: string, { body }: { body: Body }) =>
      body.from === undefined
        ? OLD_API
        : refused(403, "account_suspended", "your account is suspended"),
    );

    const state = await confirmSeats({}, form());

    expect(state).toEqual({ message: "Your account is suspended." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
