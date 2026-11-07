import { describe, expect, it } from "vitest";
import { apiError, retryAfterSeconds } from "./errors";

/*
  The audit before release, O10: a dozen actions passed the API's refusal
  (`err.message`) straight to the screen, long dashes and all. The refusal is
  stripped where it enters instead.
*/
describe("an API refusal, as the portal holds it", () => {
  it("keeps the code and the status, and prints the words without long dashes", () => {
    const err = apiError(
      {
        error: {
          code: "invalid_input",
          message:
            "Cancel the bookings you cannot take first \u2014 we will refund them",
          details: {
            to: "at most 30 days after from \u2013 counting both",
            n: 3,
          },
          requestId: "req_1",
        },
      },
      400,
    );
    expect(err.code).toBe("invalid_input");
    expect(err.status).toBe(400);
    expect(err.requestId).toBe("req_1");
    expect(err.message).not.toMatch(/[\u2013\u2014\u2015]/);
    expect(err.message).toMatch(
      /^Cancel the bookings you cannot take first\. We will refund them/,
    );
    expect(err.details).toEqual({
      to: expect.not.stringMatching(/[\u2013\u2014\u2015]/),
      n: 3,
    });
  });

  it("falls back to the response's request id, and to no details", () => {
    const err = apiError(
      { error: { code: "not_found", message: "gone" } },
      404,
      "req_hdr",
    );
    expect(err.requestId).toBe("req_hdr");
    expect(err.details).toBeUndefined();
    expect(err.isNotFound).toBe(true);
  });
});

/*
  yuvoy-operator#175: the check-in action waits `Retry-After` seconds before
  it sends again. The API sends whole seconds; anything else is not read, and
  the action waits its own default.
*/
describe("a Retry-After header", () => {
  it("is read as whole seconds", () => {
    expect(retryAfterSeconds("2")).toBe(2);
    expect(retryAfterSeconds(" 7 ")).toBe(7);
    expect(retryAfterSeconds("0")).toBe(0);
  });

  it("is not read when it is missing, a date or not whole seconds", () => {
    for (const value of [
      null,
      "",
      "1.5",
      "-1",
      "soon",
      "Wed, 21 Oct 2026 07:28:00 GMT",
    ]) {
      expect(retryAfterSeconds(value)).toBeUndefined();
    }
  });

  it("is kept on the refusal it came with", () => {
    const err = apiError(
      { error: { code: "idempotency_in_progress", message: "wait" } },
      409,
      undefined,
      2,
    );
    expect(err.retryAfter).toBe(2);
  });
});
