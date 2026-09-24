import { describe, expect, it } from "vitest";
import { apiError } from "./errors";

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
