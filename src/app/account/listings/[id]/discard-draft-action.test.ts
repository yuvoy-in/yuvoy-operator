import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";

/*
  Discarding a draft nobody has seen (yuvoy-operator#112), against
  `DELETE /experiences/{id}`: 204, 409 once sent, 404 when it is not here, and
  405 from an API that predates the route (yuvoy-api#249).
*/

const del = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn();
let canManage = true;

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ DELETE: del }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage } }),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

const { discardDraft } = await import("./actions");

function form(experienceId = "exp_draft"): FormData {
  const f = new FormData();
  f.set("experienceId", experienceId);
  return f;
}

const refused = (status: number, code: string, message: string) => ({
  data: undefined,
  error: new OperatorApiError({ code, message, status }),
});

beforeEach(() => {
  del.mockReset();
  revalidatePath.mockReset();
  redirect.mockReset();
  canManage = true;
});

describe("discarding a draft", () => {
  it("deletes it and goes back to Business, which re-reads without it", async () => {
    del.mockResolvedValue({ data: undefined, error: undefined });

    await discardDraft({}, form());

    expect(del).toHaveBeenCalledWith("/experiences/{id}", {
      params: { path: { id: "exp_draft" } },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/account");
    expect(redirect).toHaveBeenCalledWith("/account");
  });

  it("refuses a staff login before the request", async () => {
    canManage = false;

    const state = await discardDraft({}, form());

    expect(state).toEqual({
      message: "Only owners, admins and managers can discard a draft.",
    });
    expect(del).not.toHaveBeenCalled();
  });

  it("asks nothing without a listing", async () => {
    const state = await discardDraft({}, new FormData());

    expect(state.message).toBe("There is no draft to discard.");
    expect(del).not.toHaveBeenCalled();
  });
});

/* Every refusal leaves the draft where it is, and never reads as deleted. */
describe("a discard that did not happen", () => {
  const stayed = () => {
    expect(redirect).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  };

  it("says a sent listing's 409 in the API's words", async () => {
    del.mockResolvedValue(
      refused(
        409,
        "conflict",
        "only a draft can be deleted. This listing has already been sent to us",
      ),
    );

    const state = await discardDraft({}, form());

    expect(state).toEqual({
      message:
        "Only a draft can be deleted. This listing has already been sent to us.",
    });
    stayed();
  });

  it("says a missing listing's 404 in the API's words", async () => {
    del.mockResolvedValue(refused(404, "not_found", "no such listing"));

    const state = await discardDraft({}, form("exp_gone"));

    expect(state).toEqual({ message: "No such listing." });
    stayed();
  });

  it("reads an API without the route as not available yet, whatever its body", async () => {
    // The envelope the API writes for a method a route does not take.
    del.mockResolvedValue(
      refused(405, "method_not_allowed", "method not allowed"),
    );
    expect(await discardDraft({}, form())).toEqual({
      message: "Discarding a draft is not available yet. It is still here.",
    });

    // And no envelope at all, which the client turns into `internal_error`.
    del.mockResolvedValue(
      refused(405, "internal_error", "The server answered 405."),
    );
    expect(await discardDraft({}, form())).toEqual({
      message: "Discarding a draft is not available yet. It is still here.",
    });
    stayed();
  });

  it("says a suspended account is suspended", async () => {
    del.mockResolvedValue(
      refused(403, "account_suspended", "your account is suspended"),
    );

    const state = await discardDraft({}, form());

    expect(state.message).toBe("Your account is suspended.");
    stayed();
  });

  it("says who may, on the API's role refusal", async () => {
    del.mockResolvedValue(
      refused(403, "forbidden", "only an owner, admin or manager can delete"),
    );

    const state = await discardDraft({}, form());

    expect(state.message).toBe(
      "Only owners, admins and managers can discard a draft.",
    );
    stayed();
  });

  it("says the draft is still there when there is no signal", async () => {
    del.mockRejectedValue(new OperatorNetworkError());

    const state = await discardDraft({}, form());

    expect(state).toEqual({
      message: "No signal. The draft is still here. Try again.",
    });
    stayed();
  });

  it("says the draft is still there on anything else", async () => {
    del.mockResolvedValue(refused(500, "internal_error", "Something broke"));

    const state = await discardDraft({}, form());

    expect(state).toEqual({ message: "The draft is still here. Try again." });
    stayed();
  });
});
