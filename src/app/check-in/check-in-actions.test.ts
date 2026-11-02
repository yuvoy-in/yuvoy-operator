import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { NOT_A_CODE, UNSENT } from "./check-in-result";
import { checkInWithCode } from "./actions";

/*
  `checkInWithCode` against each answer of yuvoy-api's `checkInByCode`
  (host_check_in.go at a53d7b3a), yuvoy-operator#175. A 404 is never success,
  and a code that missed is never offered again.
*/

const post = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok_owner", me: { id: "usr_1" } }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));

const KEY = "msg_7f3c2a1e-9d4b-4c6e-8a2f-1b5d9e0c7a34";
const ARRIVED = {
  bookingId: "bkg_1",
  reference: "YV-4K2M9P7Q",
  name: "Asha Menon",
  guests: 2,
  slotId: "slot_1",
  arrivedAt: "2026-11-03T01:30:00Z",
  alreadyCheckedIn: false,
};

function refused(
  status: number,
  code: string,
  message = "",
  details?: unknown,
): OperatorApiError {
  return new OperatorApiError({ status, code, message, details });
}

// A block, not an arrow that returns the mock: vitest calls a function
// returned from beforeEach as the test's teardown.
beforeEach(() => {
  post.mockReset();
});

describe("what is sent", () => {
  it("sends the normalised code, the reference and via, under the key", async () => {
    post.mockResolvedValue({ data: ARRIVED });
    const result = await checkInWithCode({
      code: "k7qm-2xpa",
      reference: "YV-4K2M9P7Q",
      via: "portal_link",
      key: KEY,
    });
    expect(result).toEqual({ ok: true, ...ARRIVED });
    expect(post).toHaveBeenCalledWith("/check-ins", {
      params: { header: { "Idempotency-Key": KEY } },
      body: { code: "K7QM2XPA", via: "portal_link", reference: "YV-4K2M9P7Q" },
    });
  });

  it("sends a typed code with no reference, and never a seenAt", async () => {
    post.mockResolvedValue({ data: ARRIVED });
    await checkInWithCode({ code: "K7QM2XPA", via: "typed", key: KEY });
    const [, init] = post.mock.calls[0];
    expect(init.body).toEqual({ code: "K7QM2XPA", via: "typed" });
  });

  it("sends the code without a key that is not the API's shape", async () => {
    post.mockResolvedValue({ data: ARRIVED });
    await checkInWithCode({ code: "K7QM2XPA", via: "typed", key: "short" });
    expect(post.mock.calls[0][1].params).toEqual({});
  });

  it("sends nothing for a code that cannot be one", async () => {
    expect(await checkInWithCode({ code: "K7QM", via: "typed" })).toEqual({
      ok: false,
      message: NOT_A_CODE,
    });
    expect(post).not.toHaveBeenCalled();
  });
});

describe("a refusal", () => {
  async function answer(err: Error) {
    post.mockRejectedValue(err);
    return checkInWithCode({
      code: "K7QM2XPA",
      reference: "YV-4K2M9P7Q",
      via: "portal_link",
      key: KEY,
    });
  }

  it("is never success on a 404, and is not offered again", async () => {
    const said = "This code is not for one of your bookings.";
    expect(await answer(refused(404, "not_found", said))).toEqual({
      ok: false,
      message: said,
      byName: true,
    });
  });

  it("says a mismatch in the API's words, with no retry", async () => {
    const said =
      "This code does not match booking YV-4K2M9P7Q. Check them in by name if it is them.";
    expect(await answer(refused(409, "check_in_code_mismatch", said))).toEqual({
      ok: false,
      message: said,
      byName: true,
    });
  });

  it("says another day with its year, from validOn", async () => {
    const result = await answer(
      refused(409, "check_in_not_today", "This code is for Wed 4 Nov.", {
        validOn: "2026-11-04",
      }),
    );
    expect(result).toEqual({
      ok: false,
      message: "This code is for 4 November 2026. Nobody was checked in.",
      byName: true,
    });
  });

  it("keeps the API's sentence when validOn is missing", async () => {
    const result = await answer(
      refused(409, "check_in_not_today", "This code is for Wed 4 Nov."),
    );
    expect(result).toMatchObject({ message: "This code is for Wed 4 Nov." });
  });

  it("says a settled booking in our words, not the store's", async () => {
    const result = await answer(
      refused(409, "not_on_this_departure", "booking bkg_1 is cancelled"),
    );
    expect(result).toEqual({
      ok: false,
      message:
        "This booking cannot be checked in. It is cancelled, declined or already settled.",
      byName: true,
    });
  });

  it("stops at the miss limit and when paused, with no retry", async () => {
    for (const err of [
      refused(
        429,
        "rate_limited",
        "Too many codes did not match. Check people in by name for now.",
      ),
      refused(
        503,
        "check_in_paused",
        "Check-in by code is paused. Use Aboard.",
      ),
    ]) {
      const result = await answer(err);
      expect(result).toEqual({ ok: false, message: err.message, byName: true });
    }
  });

  it("reads a 400 on the code as not a code, and any other 400 as a bad link", async () => {
    expect(
      await answer(
        refused(400, "invalid_input", "we could not read that check-in", {
          code: "must be 8 characters",
        }),
      ),
    ).toEqual({ ok: false, message: NOT_A_CODE, byName: true });
    expect(
      await answer(
        refused(400, "invalid_input", "we could not read that check-in", {
          reference: "not a reference",
        }),
      ),
    ).toEqual({
      ok: false,
      message: "That link is not complete. Nobody was checked in.",
      byName: true,
    });
  });

  it("asks for sign-in on a 401, which no code can fix", async () => {
    expect(await answer(refused(401, "unauthorized", "sign in"))).toEqual({
      ok: false,
      message: "Your session has ended. Sign in again, then check them in.",
      signIn: true,
    });
  });

  it("offers the same key again while the first is still being written", async () => {
    expect(
      await answer(refused(409, "idempotency_in_progress", "in progress")),
    ).toMatchObject({ ok: false, retry: true });
    const result = await answer(
      refused(409, "idempotency_in_progress", "in progress"),
    );
    expect(result).not.toHaveProperty("newKey");
  });

  it("never sends again after a lost answer, and sends them to Today", async () => {
    const result = await answer(
      refused(500, "idempotency_response_lost", "lost"),
    );
    expect(result).toMatchObject({ ok: false, byName: true, newKey: true });
    expect(result).not.toHaveProperty("retry");
  });

  it("takes a new key after one the API will not take again", async () => {
    for (const code of ["idempotency_key_reuse", "idempotency_key_malformed"]) {
      expect(await answer(refused(422, code, "no"))).toEqual({
        ok: false,
        message: "That did not go. Nobody was checked in. Try again.",
        retry: true,
        newKey: true,
      });
    }
  });

  it("offers a retry on a fault of ours", async () => {
    expect(await answer(refused(502, "upstream", "bad gateway"))).toEqual({
      ok: false,
      message: "That did not go. Nobody was checked in. Try again.",
      retry: true,
      byName: true,
    });
  });

  it("says no signal when the API was not reached, and keeps the key", async () => {
    expect(await answer(new OperatorNetworkError())).toEqual({
      ok: false,
      message: UNSENT,
      retry: true,
    });
  });
});
