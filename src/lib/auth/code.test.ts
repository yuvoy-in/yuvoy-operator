import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { exchangeCode, sendCode } from "./code";

/**
 * Every refusal the two sign-in calls declare, each with its own sentence.
 *
 * yuvoy-operator#91. `POST /auth/otp` declares `400` and `429`, and
 * `POST /auth/session` declares `400`, `401`, `403 account_not_active` and
 * `429`. Two of them used to fall through to "try again shortly", which is the
 * one instruction that cannot work: a number the server refuses is refused
 * again, and an account that cannot hold a session still cannot a minute later.
 *
 * The API client is replaced, not the network: what is under test is how an
 * error the client raises becomes a sentence, and that mapping is all this
 * module decides.
 */
const post = vi.fn();
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));

function refusal(
  status: number,
  code: string,
  message: string,
  details?: unknown,
) {
  return new OperatorApiError({ status, code, message, details });
}

beforeEach(() => {
  post.mockReset();
});

describe("asking for a code", () => {
  it("goes through, and never branches on what the answer says", async () => {
    post.mockResolvedValue({ data: { sent: true, expiresIn: 600 } });
    expect(await sendCode("+919000000101")).toEqual({
      ok: true,
      devCode: undefined,
    });
  });

  it("says to wait when it is throttled", async () => {
    post.mockRejectedValue(
      refusal(429, "rate_limited", "too many requests from this address"),
    );
    expect(await sendCode("+919000000101")).toEqual({
      ok: false,
      message: "Too many attempts. Wait a minute and try again.",
    });
  });

  it("says what is wrong with a number the server refuses, in its words", async () => {
    /*
      The server's rule, which the phone field does not know. Its detail says
      what to fix; its message only says what is missing.
    */
    post.mockRejectedValue(
      refusal(
        400,
        "invalid_input",
        "we need a phone number to send a code to",
        {
          phone: "Enter your number with the country code, like +919000000000.",
        },
      ),
    );
    const sent = await sendCode("+919000000101");
    expect(sent).toEqual({
      ok: false,
      message: "Enter your number with the country code, like +919000000000.",
    });
  });

  it("falls back to the server's message, then to ours, never to 'try again shortly'", async () => {
    post.mockRejectedValue(
      refusal(400, "invalid_input", "we need a phone number to send a code to"),
    );
    expect(await sendCode("+919000000101")).toEqual({
      ok: false,
      message: "We need a phone number to send a code to.",
    });

    post.mockRejectedValue(refusal(400, "invalid_input", ""));
    const bare = await sendCode("+919000000101");
    expect(bare).toEqual({
      ok: false,
      message: "That number was not accepted. Check it and try again.",
    });
  });

  it("says there is no signal when there is none", async () => {
    post.mockRejectedValue(new OperatorNetworkError());
    const sent = await sendCode("+919000000101");
    expect(sent.ok).toBe(false);
    if (!sent.ok) expect(sent.message).toMatch(/Check your signal/);
  });

  it("keeps 'try again shortly' for the failure that a retry can fix", async () => {
    post.mockRejectedValue(refusal(500, "internal_error", "boom"));
    expect(await sendCode("+919000000101")).toEqual({
      ok: false,
      message: "We could not send a code just now. Try again shortly.",
    });
  });
});

describe("trading a code for a session", () => {
  it("returns the token", async () => {
    post.mockResolvedValue({ data: { token: "tok_1" } });
    expect(await exchangeCode("+919000000101", "424242")).toEqual({
      ok: true,
      token: "tok_1",
    });
  });

  it("gives a wrong code one sentence, whatever made it wrong", async () => {
    post.mockRejectedValue(
      refusal(401, "unauthorized", "that code did not work. Request a new one"),
    );
    expect(await exchangeCode("+919000000101", "000000")).toEqual({
      ok: false,
      message: "That code did not work. Ask for a new one.",
    });
  });

  it("says a closed account cannot sign in, and who to call, rather than 'try again'", async () => {
    /*
      `403 account_not_active`: the code was right and the person is fine, but
      the account cannot hold a session. Retrying never helps, and it used to be
      what the screen told them to do.
    */
    post.mockRejectedValue(
      refusal(
        403,
        "account_not_active",
        "this account cannot take bookings right now. Talk to us",
      ),
    );
    const result = await exchangeCode("+919000000101", "424242");
    expect(result).toEqual({
      ok: false,
      message:
        "This business account is on hold, so it cannot be signed into. Call us on +91 81216 57657.",
    });
  });

  it("says to wait when it is throttled, not to ask for another code", async () => {
    post.mockRejectedValue(refusal(429, "rate_limited", "slow down"));
    expect(await exchangeCode("+919000000101", "424242")).toEqual({
      ok: false,
      message: "Too many attempts. Wait a minute, then try the code again.",
    });
  });

  it("does not repeat the server's 'the code we sent' on a 400", async () => {
    /*
      This screen is never told whether a code was sent, so the API's
      sentence is not rendered here. Ours names the one thing to check.
    */
    post.mockRejectedValue(
      refusal(400, "invalid_input", "we need your number and the code we sent"),
    );
    const result = await exchangeCode("+919000000101", "42");
    expect(result).toEqual({
      ok: false,
      message: "Check the code, then try again. It is digits only.",
    });
  });

  it("says there is no signal when there is none", async () => {
    post.mockRejectedValue(new OperatorNetworkError());
    const result = await exchangeCode("+919000000101", "424242");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/Check your signal/);
  });
});
