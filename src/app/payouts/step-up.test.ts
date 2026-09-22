import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { changeBank, requestStepUp } from "./actions";

/**
 * The payout step-up, one sentence per refusal: yuvoy-operator#90 f13.
 *
 * "A wrong step-up code and a suspended account both show 'That code did not
 * work'." A suspended owner then asked for code after code that could never
 * elevate anything, and never read the one sentence that would let them act.
 *
 * The session, the API client and the cache are replaced, and nothing else:
 * what is under test is which sentence each answer becomes, and that nothing
 * after a refused code is attempted.
 */
const post = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok_owner", me: { id: "usr_1" } }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const SUSPENDED =
  "Your account has been suspended. Please reach out to admin for help.";

function bankForm(code = "424242") {
  const data = new FormData();
  data.set("code", code);
  data.set("accountHolder", "Nemo Reef Divers");
  data.set("accountNumber", "50100123456789");
  data.set("ifsc", "HDFC0001234");
  data.set("bankName", "");
  return data;
}

/** The verify call refuses with `err`; anything after it would succeed. */
function verifyRefuses(err: unknown) {
  post.mockImplementation(async (path: string) => {
    if (path === "/auth/step-up/verify") throw err;
    return { data: {} };
  });
}

beforeEach(() => {
  post.mockReset();
});

describe("using the code", () => {
  it("says a suspended account is suspended, not that the code was wrong", async () => {
    verifyRefuses(
      new OperatorApiError({
        status: 403,
        code: "account_suspended",
        message: SUSPENDED,
      }),
    );
    const state = await changeBank({}, bankForm());
    expect(state.message).toBe(SUSPENDED);
    expect(state.message).not.toMatch(/code did not work/);
    // The code is not what is wrong, so the field is not marked.
    expect(state.field).toBeUndefined();
  });

  it("says a wrong code is a wrong code, on the code field", async () => {
    verifyRefuses(
      new OperatorApiError({
        status: 401,
        code: "unauthorized",
        message: "that code did not work",
      }),
    );
    const state = await changeBank({}, bankForm("000000"));
    expect(state).toEqual({
      field: "code",
      message: "That code did not work. Ask for a new one.",
    });
  });

  it("says a session that ran out is a session, not a code", async () => {
    verifyRefuses(
      new OperatorApiError({
        status: 401,
        code: "session_expired",
        message: "your session has ended. Sign in again",
      }),
    );
    const state = await changeBank({}, bankForm());
    expect(state.message).toBe(
      "Your session has ended. Sign in again, then ask for a new code.",
    );
    expect(state.field).toBeUndefined();
  });

  it("does not blame the code for a failure to check it", async () => {
    verifyRefuses(
      new OperatorApiError({
        status: 500,
        code: "internal_error",
        message: "boom",
      }),
    );
    const state = await changeBank({}, bankForm());
    expect(state.message).toBe(
      "We could not check the code just now. Nothing was changed. Try again.",
    );
  });

  it("says there is no signal when there is none", async () => {
    verifyRefuses(new OperatorNetworkError());
    const state = await changeBank({}, bankForm());
    expect(state.message).toBe("No signal. Nothing was changed.");
  });

  it("raises nothing after a refused code", async () => {
    verifyRefuses(
      new OperatorApiError({
        status: 403,
        code: "account_suspended",
        message: SUSPENDED,
      }),
    );
    await changeBank({}, bankForm());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe("/auth/step-up/verify");
  });

  it("names where the code went when it is missing, and no phone", async () => {
    const state = await changeBank({}, bankForm(""));
    expect(state.field).toBe("code");
    expect(state.message).toBe("Enter the code that went to the owner.");
    expect(post).not.toHaveBeenCalled();
  });
});

describe("asking for the code", () => {
  it("draws the field only when something is carrying the code", async () => {
    post.mockResolvedValue({ data: { sent: true, expiresIn: 600 } });
    expect(await requestStepUp()).toEqual({ sent: true, devCode: undefined });

    post.mockResolvedValue({ data: { sent: false } });
    expect(await requestStepUp()).toEqual({
      sent: false,
      nobodyToSendTo: true,
    });
  });

  it("says a suspended account is suspended", async () => {
    post.mockRejectedValue(
      new OperatorApiError({
        status: 403,
        code: "account_suspended",
        message: SUSPENDED,
      }),
    );
    expect(await requestStepUp()).toEqual({ message: SUSPENDED });
  });

  it("says to wait when it is throttled", async () => {
    post.mockRejectedValue(
      new OperatorApiError({ status: 429, code: "rate_limited", message: "" }),
    );
    expect(await requestStepUp()).toEqual({
      message: "Too many attempts. Wait a minute.",
    });
  });

  it("says a session that ran out is a session", async () => {
    post.mockRejectedValue(
      new OperatorApiError({
        status: 401,
        code: "unauthorized",
        message: "sign in to continue",
      }),
    );
    expect(await requestStepUp()).toEqual({
      message:
        "Your session has ended. Sign in again, then ask for a new code.",
    });
  });
});
