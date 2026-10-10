import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The visitor's address, for the API's per-IP limits (yuvoy-api#282 item 3,
 * yuvoy-api#299): every call this server makes names the person it is made
 * for, once the shared secret is set, and nothing changes until it is.
 */

const request = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
}));
vi.mock("next/headers", () => request);

const { operatorApi } = await import("./server-client");
const { visitorAddressHeaders } = await import("./visitor");
const { fetchStatement } = await import("@/lib/money/statement");

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

type Call = { input: unknown; init?: RequestInit };

function network(calls: Call[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init });
    return Response.json({ id: "usr_1" });
  });
}

const sent = (call: Call) => new Headers(call.init?.headers);

function visiting(headers: Record<string, string>) {
  request.headers.mockResolvedValue(new Headers(headers));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  request.headers.mockReset();
});

describe("the visitor's address, for the API's per-IP limits", () => {
  it("names the person on a read, a write and a sign-in code", async () => {
    vi.stubEnv("PROXY_CLIENT_IP_SECRET", SECRET);
    visiting({
      "x-real-ip": "203.0.113.9",
      // Anybody can write this one, so it is never what is sent.
      "x-forwarded-for": "198.51.100.1, 203.0.113.9",
    });
    const calls: Call[] = [];
    vi.stubGlobal("fetch", network(calls));

    await operatorApi("tok").GET("/me", {});
    await operatorApi("tok").POST("/team", {
      body: { phone: "+919000000101", name: "Arun" },
    });
    // Asked for before there is any session, and the limit that matters most.
    await operatorApi().POST("/auth/otp", { body: { phone: "+919000000101" } });

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(sent(call).get("x-yuvoy-client-ip")).toBe("203.0.113.9");
      expect(sent(call).get("x-yuvoy-proxy-secret")).toBe(SECRET);
    }
    expect(sent(calls[0]).get("authorization")).toBe("Bearer tok");
  });

  it("names them on a statement download too", async () => {
    vi.stubEnv("PROXY_CLIENT_IP_SECRET", SECRET);
    visiting({ "x-real-ip": "203.0.113.9" });
    const calls: Call[] = [];
    vi.stubGlobal("fetch", network(calls));

    await fetchStatement("tok", {
      id: "stl_1",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-07",
    });

    expect(sent(calls[0]).get("x-yuvoy-client-ip")).toBe("203.0.113.9");
    expect(sent(calls[0]).get("x-yuvoy-proxy-secret")).toBe(SECRET);
    expect(sent(calls[0]).get("accept")).toBe("text/csv");
  });

  it("sends neither without the secret, and does not read the request", async () => {
    visiting({ "x-real-ip": "203.0.113.9" });
    const calls: Call[] = [];
    vi.stubGlobal("fetch", network(calls));

    await operatorApi("tok").GET("/me", {});

    expect(sent(calls[0]).has("x-yuvoy-client-ip")).toBe(false);
    expect(sent(calls[0]).has("x-yuvoy-proxy-secret")).toBe(false);
    expect(request.headers).not.toHaveBeenCalled();
  });

  it("sends neither outside a request, and the call still goes", async () => {
    vi.stubEnv("PROXY_CLIENT_IP_SECRET", SECRET);
    request.headers.mockRejectedValue(
      new Error("`headers` was called outside a request scope."),
    );
    const calls: Call[] = [];
    vi.stubGlobal("fetch", network(calls));

    const { response } = await operatorApi("tok").GET("/me", {});

    expect(response.status).toBe(200);
    expect(sent(calls[0]).has("x-yuvoy-client-ip")).toBe(false);
    expect(sent(calls[0]).has("x-yuvoy-proxy-secret")).toBe(false);
  });

  it("takes an IPv6 address as it is", () => {
    vi.stubEnv("PROXY_CLIENT_IP_SECRET", SECRET);
    expect(
      visitorAddressHeaders(new Headers({ "x-real-ip": "2001:db8::1" })),
    ).toEqual({
      "X-Yuvoy-Client-IP": "2001:db8::1",
      "X-Yuvoy-Proxy-Secret": SECRET,
    });
  });

  it("sends neither with a secret the API would not boot with", () => {
    const quiet = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const secret of ["short", `${SECRET.slice(0, 20)} ${SECRET}`]) {
      vi.stubEnv("PROXY_CLIENT_IP_SECRET", secret);
      expect(
        visitorAddressHeaders(new Headers({ "x-real-ip": "203.0.113.9" })),
      ).toEqual({});
    }
    // Said once, by name, never by value.
    expect(quiet).toHaveBeenCalledTimes(1);
    expect(String(quiet.mock.calls[0][0])).toContain("PROXY_CLIENT_IP_SECRET");
    expect(String(quiet.mock.calls[0][0])).not.toContain(SECRET.slice(0, 20));
    quiet.mockRestore();
  });

  it("sends neither for an address that is not one bare address", () => {
    vi.stubEnv("PROXY_CLIENT_IP_SECRET", SECRET);
    for (const address of [
      "",
      "203.0.113.9, 198.51.100.1",
      "203.0.113.9:443",
      "[2001:db8::1]",
      "fe80::1%en0",
      "not an address",
    ]) {
      expect(
        visitorAddressHeaders(new Headers({ "x-real-ip": address })),
      ).toEqual({});
    }
    expect(visitorAddressHeaders(new Headers())).toEqual({});
    expect(visitorAddressHeaders(undefined)).toEqual({});
  });
});
