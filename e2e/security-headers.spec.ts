import { test, expect } from "@playwright/test";

/*
  Security headers, asserted against the running portal — yuvoy-operator#37.

  `next.config.ts` builds the policy from environment, so the only place the
  real one exists is a deployed response. A green unit test on the builder says
  the string is right; only this says the string arrived.
*/
test.describe("security headers", () => {
  test("every response carries the enforced policy", async ({ request }) => {
    const headers = (await request.get("/sign-in")).headers();

    /*
      The WHOLE policy is enforced as of 9 Sep 2026 — yuvoy-operator#37. It
      shipped report-only in the morning and was enforced the same day against
      this suite rather than a waiting period: 342 tests drive the real
      production build in a real browser, across every screen including both
      media uploaders and every role gate.
    */
    const enforced = headers["content-security-policy"] ?? "";
    expect(enforced).toContain("default-src 'none'");
    expect(enforced).toContain("connect-src");
    expect(enforced).toContain("form-action 'self'");
    expect(enforced).not.toContain("'unsafe-eval'");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("no-referrer");
    expect(headers["strict-transport-security"]).toContain("preload");
    expect(headers["cache-control"]).toContain("no-store");
  });

  test("the reported policy never names the API origin", async ({
    request,
  }) => {
    /*
      Nothing here talks to the API from a browser — `/operator/v1` refuses
      CORS, the client is `server-only`, and `OPERATOR_API_URL` is deliberately
      not `NEXT_PUBLIC_`. Putting it in a header would publish on every
      response the origin that variable is kept server-side to hide.
    */
    const policy =
      (await request.get("/sign-in")).headers()[
        "content-security-policy-report-only"
      ] ?? "";

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).not.toContain("/operator/v1");
    expect(policy).not.toContain("api.yuvoy.in");
  });

  test("the enforced and reported policies are the same", async ({
    request,
  }) => {
    /*
      Both headers carry one directive list. Report-only is kept alongside the
      enforced copy because an enforced-only header blocks SILENTLY, and the
      first upload after this deploys is the thing to watch — a console line
      naming the directive is what makes that watchable.
    */
    const headers = (await request.get("/sign-in")).headers();
    expect(headers["content-security-policy-report-only"]).toBe(
      headers["content-security-policy"],
    );
  });
});
