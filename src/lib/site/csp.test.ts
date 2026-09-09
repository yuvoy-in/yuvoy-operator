import { describe, it, expect } from "vitest";
import { cspDirectives, enforcedCsp, reportOnlyCsp } from "./csp";

const PROD = { dev: false };

function directive(policy: string, name: string): string | undefined {
  return policy.split("; ").find((d) => d === name || d.startsWith(`${name} `));
}

/**
 * Source expressions as TOKENS, not as a substring search.
 *
 * The two wildcards that would gut this policy — a bare `https:` scheme source
 * and a bare `*` — are substrings of perfectly good host sources like
 * `https://*.cloudflarestream.com`, so a substring assertion passes when the
 * policy is wrong.
 */
function sources(policy: string, name: string): string[] {
  return (directive(policy, name) ?? "").split(" ").slice(1);
}

/**
 * yuvoy-operator#37. A stolen operator session exposes a business's customer
 * list, its capacity and where its money goes, so `connect-src` and
 * `form-action` are the two directives that matter.
 */
describe("Content-Security-Policy", () => {
  it("leaves an injected script nowhere to send a session", () => {
    const connect = sources(reportOnlyCsp(PROD), "connect-src");
    expect(connect).toContain("'self'");
    expect(connect).not.toContain("*");
    expect(connect).not.toContain("https:");
    expect(connect).not.toContain("http:");
  });

  it("does not publish the API origin, which the browser never calls", () => {
    /*
      `/operator/v1` refuses CORS by design, `server-client.ts` is
      `import "server-only"`, and `OPERATOR_API_URL` is deliberately not
      `NEXT_PUBLIC_`. Naming it here would put it in a header on every
      response — the same leak keeping the variable server-only prevents.
    */
    const policy = reportOnlyCsp(PROD);
    expect(policy).not.toContain("api.yuvoy.in");
    expect(policy).not.toContain("/operator/v1");
  });

  it("closes the exit a rewritten Server Action would use", () => {
    // Every write here is a Server Action, which is a POST to this origin. A
    // rewritten `action` never touches `fetch`, so `connect-src` cannot see it.
    expect(directive(reportOnlyCsp(PROD), "form-action")).toBe(
      "form-action 'self'",
    );
    expect(directive(reportOnlyCsp(PROD), "base-uri")).toBe("base-uri 'none'");
    expect(directive(reportOnlyCsp(PROD), "default-src")).toBe(
      "default-src 'none'",
    );
  });

  it("can still upload a clip and show a poster", () => {
    // Bytes go straight from the browser to the provider — a clip over tus, a
    // photograph and a logo as multipart. Blocking that is an upload that
    // fails silently on the screens an operator needs most.
    const policy = reportOnlyCsp(PROD);
    expect(directive(policy, "connect-src")).toContain("cloudflarestream.com");
    expect(directive(policy, "connect-src")).toContain("imagedelivery.net");
    expect(directive(policy, "img-src")).toContain("imagedelivery.net");
  });

  it("never ships eval, loopback or dev's websocket to an operator", () => {
    const policy = reportOnlyCsp(PROD);
    expect(directive(policy, "script-src")).not.toContain("unsafe-eval");
    expect(sources(policy, "connect-src")).not.toContain("ws:");
    expect(policy).not.toContain("127.0.0.1");
    expect(policy).not.toContain("localhost");
  });

  it("gives development the mock upload host, and only in development", () => {
    const dev = reportOnlyCsp({
      dev: true,
      mockUploadOrigin: "http://127.0.0.1:3299",
    });
    expect(directive(dev, "connect-src")).toContain("http://127.0.0.1");
    expect(
      reportOnlyCsp({ dev: false, mockUploadOrigin: "http://127.0.0.1:3299" }),
    ).not.toContain("3299");
  });

  it("enforces only what cannot break a page that works today", () => {
    const enforced = enforcedCsp(PROD);
    expect(enforced).toBe(
      "object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    );
    expect(enforced).not.toContain("connect-src");
  });

  it("keeps every directive to one declaration", () => {
    // A repeated directive is not merged — the first wins and the second is
    // silently ignored, which is how a policy ends up looser than it reads.
    const names = cspDirectives(PROD).map((d) => d.split(" ")[0]);
    expect(new Set(names).size).toBe(names.length);
  });
});
