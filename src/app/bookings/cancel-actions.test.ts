import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  Cancelling one booking, at the boundary the browser cannot see (#43 item 4).

  The confirm is named now, not typed (owner ruling, 3 Oct 2026): the form
  fills `confirmReference` with the booking's own, so a missing or mismatched
  one is a page out of step with the booking, never a person who typed it
  wrong, and the sentences say so.
*/

const post = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));

const { cancelBooking } = await import("./cancel-actions");

function form(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const fields = {
    bookingId: "bkg_1",
    reasonCode: "weather",
    note: "",
    confirmReference: "YV-4K2M9P7Q",
    ...over,
  };
  for (const [key, value] of Object.entries(fields)) f.set(key, value);
  return f;
}

function refuses(code: string, status = 409) {
  post.mockResolvedValue({
    data: undefined,
    error: new OperatorApiError({ code, message: "refused", status }),
  });
}

beforeEach(() => post.mockReset());

describe("cancelling a booking", () => {
  it("sends the reason and the booking's own reference, and no empty note", async () => {
    post.mockResolvedValue({
      data: { refundedPaise: 900_000, seatsReleased: 2 },
      error: undefined,
    });

    const state = await cancelBooking({}, form());

    expect(post.mock.calls[0][1]).toEqual({
      params: { path: { id: "bkg_1" } },
      body: { reasonCode: "weather", confirmReference: "YV-4K2M9P7Q" },
    });
    expect(state.done).toEqual({ refundedPaise: 900_000, seatsReleased: 2 });
  });

  it("asks why when no reason was picked, and sends nothing", async () => {
    const state = await cancelBooking({}, form({ reasonCode: "" }));

    expect(state).toEqual({
      field: "reasonCode",
      message: "Choose why they cannot go.",
    });
    expect(post).not.toHaveBeenCalled();
  });

  it("does not ask for a reason when it is the reference that is missing", async () => {
    const state = await cancelBooking({}, form({ confirmReference: "" }));

    expect(state.message).toBe(
      "This booking's reference did not reach us. Nothing was cancelled. Reload the page and try again.",
    );
    expect(state.field).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });

  it("says a mismatch is the page out of step, not a mistype", async () => {
    refuses("confirmation_required", 400);

    const state = await cancelBooking({}, form());

    expect(state.message).toBe(
      "That confirm did not match this booking. Nothing was cancelled. Reload the page and try again.",
    );
  });

  it("reports a retry after it worked as done, not as a failure", async () => {
    refuses("already_cancelled");

    expect(await cancelBooking({}, form())).toEqual({ alreadyCancelled: true });
  });
});
