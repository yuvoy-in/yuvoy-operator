import { describe, it, expect, vi, afterEach } from "vitest";

/**
 * The API base URL, which comes from a dashboard rather than from the repo.
 *
 * These cases are written from a failure that happened next door rather than
 * here: `yuvoy-app` took `NEXT_PUBLIC_SITE_URL` on trust and three production
 * deploys died at module evaluation, while the local build stayed green
 * because the variable is unset locally. Nothing about a dashboard value is
 * checkable from a test, so the code that reads it has to be.
 */

async function load(value?: string) {
  vi.resetModules();
  vi.stubEnv("OPERATOR_API_URL", value ?? "");
  return import("./server-client");
}

afterEach(() => vi.unstubAllEnvs());

describe("apiBaseUrl", () => {
  it("falls back when the variable is unset OR empty", async () => {
    // `??` does not catch "" — and an env var created with no value is the
    // easiest mistake there is to make.
    expect((await load()).apiBaseUrl()).toBe(
      "http://localhost:8093/operator/v1",
    );
    expect((await load("   ")).apiBaseUrl()).toBe(
      "http://localhost:8093/operator/v1",
    );
  });

  it("strips a trailing slash", async () => {
    // openapi-fetch appends "/slots". `…/operator/v1//slots` is a different
    // request, and `//slots` alone is protocol-relative and a different host.
    const { apiBaseUrl } = await load("https://api.yuvoy.in/operator/v1/");
    expect(apiBaseUrl()).toBe("https://api.yuvoy.in/operator/v1");
  });

  it("strips the quotes a paste brings with it", async () => {
    const { apiBaseUrl } = await load('"https://api.yuvoy.in/operator/v1"');
    expect(apiBaseUrl()).toBe("https://api.yuvoy.in/operator/v1");
  });

  it("refuses anything that is not http(s)", async () => {
    // A `file:` or `javascript:` base is not a typo worth guessing at.
    const { apiBaseUrl } = await load("file:///etc/passwd");
    expect(() => apiBaseUrl()).toThrow(/OPERATOR_API_URL/);
  });

  it("describes a bad value by shape, since deploy logs mask it", async () => {
    const { apiBaseUrl } = await load("api.yuvoy.in/operator/v1");
    expect(() => apiBaseUrl()).toThrow(/length \d+, scheme no/);
  });
});
