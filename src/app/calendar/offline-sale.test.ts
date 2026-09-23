import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";

/*
  A counter sale refused because the business is suspended (yuvoy-operator#90
  f13). It read "Not recorded. Try again.", a retry that can never succeed
  with the one fact that explains it hidden.

  And taking one back (yuvoy-api#226, op#89 f12): a mistyped 20 instead of 2
  took the whole boat and refused every accept on it, with nothing an
  operator could do about it from the portal.
*/

const post = vi.fn();
const del = vi.fn();
const revalidatePath = vi.fn();
const me = { canManage: true };

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post, DELETE: del }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { recordOfflineSale, takeBackOfflineSale } = await import("./actions");

function form(): FormData {
  const f = new FormData();
  f.set("slotId", "slot_1");
  f.set("seats", "2");
  f.set("note", "");
  return f;
}

function takeBackForm(saleId = "adj_1"): FormData {
  const f = new FormData();
  f.set("slotId", "slot_1");
  f.set("saleId", saleId);
  return f;
}

function refused(status: number, code: string, message: string) {
  return {
    data: undefined,
    error: new OperatorApiError({ code, message, status }),
  };
}

beforeEach(() => {
  post.mockReset();
  del.mockReset();
  revalidatePath.mockReset();
  me.canManage = true;
});

describe("recording a counter sale", () => {
  it("says the account is suspended, in the API's words", async () => {
    post.mockResolvedValue(
      refused(
        403,
        "account_suspended",
        "your account is suspended while we review a complaint",
      ),
    );

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

  it("keeps the entry's id, which is what the undo sends back", async () => {
    post.mockResolvedValue({
      data: {
        id: "adj_1",
        seatsRecorded: 2,
        seatsRemaining: 4,
        totalSoldOffline: 2,
      },
      error: undefined,
    });

    const state = await recordOfflineSale({}, form());

    expect(state.result?.id).toBe("adj_1");
  });

  it("is sent for a staff login too, because the API gates no role here", async () => {
    /*
      yuvoy-api#226, and the owner's ruling of 23 Sep 2026: everybody signed
      in may record a counter sale. This used to refuse staff before the
      request, with a sentence that said managers only.
    */
    me.canManage = false;
    post.mockResolvedValue({
      data: { id: "adj_2", seatsRecorded: 2, seatsRemaining: 4 },
      error: undefined,
    });

    const state = await recordOfflineSale({}, form());

    expect(post).toHaveBeenCalledTimes(1);
    expect(state.message).toBeUndefined();
    expect(state.result?.seatsRecorded).toBe(2);
  });
});

describe("taking a counter sale back", () => {
  it("sends the entry and says the departure's new numbers", async () => {
    del.mockResolvedValue({
      data: { seatsTakenBack: 2, seatsRemaining: 6, totalSoldOffline: 0 },
      error: undefined,
    });

    const state = await takeBackOfflineSale({}, takeBackForm());

    expect(del).toHaveBeenCalledWith("/slots/{id}/offline-sales/{saleId}", {
      params: { path: { id: "slot_1", saleId: "adj_1" } },
    });
    expect(state).toEqual({
      result: { seatsTakenBack: 2, seatsRemaining: 6, totalSoldOffline: 0 },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
    expect(revalidatePath).toHaveBeenCalledWith("/today/slot_1");
  });

  it("is sent for a staff login too: the person who mistypes is at the counter", async () => {
    me.canManage = false;
    del.mockResolvedValue({
      data: { seatsTakenBack: 2, seatsRemaining: 6, totalSoldOffline: 0 },
      error: undefined,
    });

    const state = await takeBackOfflineSale({}, takeBackForm());

    expect(del).toHaveBeenCalledTimes(1);
    expect(state.result).toBeDefined();
  });

  it("reads a second take-back as done: the seats are already back", async () => {
    del.mockResolvedValue(
      refused(
        409,
        "already_taken_back",
        "that counter sale has already been taken back, and its seats are back on the departure",
      ),
    );

    const state = await takeBackOfflineSale({}, takeBackForm());

    expect(state).toEqual({ result: { already: true } });
    expect(revalidatePath).toHaveBeenCalledWith("/calendar");
  });

  it("says the API's own sentence when the count would go below zero", async () => {
    del.mockResolvedValue(
      refused(
        409,
        "counter_sales_below_zero",
        "taking that back would leave this departure having sold fewer than none at the counter. Record what you actually sold instead, or call us and we will straighten the numbers out",
      ),
    );

    const state = await takeBackOfflineSale({}, takeBackForm());

    expect(state.message).toBe(
      "Taking that back would leave this departure having sold fewer than none at the counter. Record what you actually sold instead, or call us and we will straighten the numbers out.",
    );
    expect(state.result).toBeUndefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the sale is not there any more on a 404", async () => {
    del.mockResolvedValue(
      refused(404, "not_found", "we could not find that counter sale"),
    );
    const state = await takeBackOfflineSale({}, takeBackForm());
    expect(state.message).toBe(
      "That counter sale is not on this departure any more.",
    );
  });

  it("says the account is suspended, in the API's words", async () => {
    del.mockResolvedValue(
      refused(
        403,
        "account_suspended",
        "your account is suspended while we review a complaint",
      ),
    );
    const state = await takeBackOfflineSale({}, takeBackForm());
    expect(state.message).toBe(
      "Your account is suspended while we review a complaint.",
    );
  });

  it("says nothing was taken back when there is no signal", async () => {
    del.mockRejectedValue(new OperatorNetworkError());
    const state = await takeBackOfflineSale({}, takeBackForm());
    expect(state.message).toBe("No signal. Nothing was taken back. Try again.");
  });

  it("sends nothing without an entry to name", async () => {
    const state = await takeBackOfflineSale({}, takeBackForm(""));
    expect(del).not.toHaveBeenCalled();
    expect(state.message).toBe("There is nothing to take back.");
  });
});
