import { describe, it, expect } from "vitest";
import { classifyMeFailure } from "./status";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";

const apiError = (code: string, status: number) =>
  new OperatorApiError({ code, message: "…", status });

/**
 * One branch, two callers, opposite sides of a redirect. A second copy is how
 * a portal ends up redirecting to a page that thinks nothing is wrong.
 */
describe("what GET /me just said about the account", () => {
  it("reads 401 as signed out", () => {
    expect(classifyMeFailure(apiError("unauthorized", 401))).toBe("signed-out");
    expect(classifyMeFailure(apiError("session_expired", 401))).toBe(
      "signed-out",
    );
  });

  it("reads 403 account_not_active as the business, not the person", () => {
    // "The person is fine, the business relationship is not." Signing them out
    // would tell them the wrong thing entirely.
    expect(classifyMeFailure(apiError("account_not_active", 403))).toBe(
      "not-active",
    );
  });

  it("does not call any other 403 a suspension", () => {
    /*
      Branch on `code`, never on the bare status. A 403 this build does not
      understand is not evidence that a business relationship ended — and
      telling an operator it did, because a server had a bad minute, is the
      most expensive wrong sentence this portal could say.
    */
    expect(classifyMeFailure(apiError("forbidden", 403))).toBe("unknown");
    expect(classifyMeFailure(apiError("step_up_required", 403))).toBe(
      "unknown",
    );
  });

  it("does not turn a bad connection into an account state", () => {
    // The jetty runs at 0.5–3 Mbps and drops. "No signal" is the common path,
    // and it must never render as "your account has been suspended".
    expect(classifyMeFailure(new OperatorNetworkError())).toBe("unknown");
    expect(classifyMeFailure(apiError("internal_error", 500))).toBe("unknown");
    expect(classifyMeFailure(new Error("boom"))).toBe("unknown");
    expect(classifyMeFailure(undefined)).toBe("unknown");
  });
});
