import { describe, it, expect, vi, afterEach } from "vitest";
import { operatorApi, READ_STALL_MS, WRITE_STALL_MS } from "./server-client";
import { OperatorNetworkError } from "./errors";

/**
 * The portal's one way to the API, when the API is slow, silent or failing
 * (production readiness, 6 Oct 2026).
 *
 * Every call here runs on the server, inside a render or a Server Action, so
 * the network is stood in for by a `fetch` that behaves as the platform's
 * does: a pending request rejects with its signal's reason when aborted.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Call = { input: unknown; init?: RequestInit };

/** Answers each call with the next of `answers`; `null` never answers. */
function network(answers: (Response | null)[], calls: Call[] = []) {
  return vi.fn(
    (input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        calls.push({ input, init });
        const answer = answers.shift();
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason));
        if (answer) resolve(answer);
      }),
  );
}

/**
 * Next 16.3's patched `fetch`, reduced to what matters here
 * (`next/dist/server/lib/patch-fetch.js` and `dedupe-fetch.js`): a GET is
 * answered from the promise of an identical one made earlier in the render,
 * failure and all, unless its init carries a signal; and a Request handed over
 * with an init is first folded into one Request, so its signal no longer does.
 */
function nextLike(real: typeof fetch): typeof fetch {
  const seen = new Map<string, Promise<Response>>();
  return (input, init) => {
    if (input instanceof Request && init) {
      input = new Request(input, init);
      init = undefined;
    }
    if (init?.signal) return real(input, init);
    const request = new Request(input, init);
    const key = JSON.stringify([
      request.url,
      request.method,
      [...request.headers.entries()],
    ]);
    let answer = seen.get(key);
    if (!answer) {
      answer = real(request);
      seen.set(key, answer);
    }
    return answer.then((response) => response.clone());
  };
}

const ok = () => Response.json({ id: "usr_1" });

describe("a read", () => {
  it("that goes quiet is given up on, and tried again on a fresh connection", async () => {
    vi.useFakeTimers();
    const calls: Call[] = [];
    vi.stubGlobal("fetch", network([null, ok()], calls));

    const read = operatorApi("tok").GET("/me", {});
    await vi.advanceTimersByTimeAsync(READ_STALL_MS + 5_000);
    const { response } = await read;

    expect(response.status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it("is retried at the API, not answered from the memo of the attempt that failed", async () => {
    let asked = 0;
    const api = vi.fn(async () => {
      asked += 1;
      return asked === 1
        ? Response.json(
            { error: { code: "internal_error", message: "Try again." } },
            { status: 503 },
          )
        : ok();
    });
    vi.stubGlobal("fetch", nextLike(api as typeof fetch));

    const { response } = await operatorApi("tok").GET("/me", {});
    expect(response.status).toBe(200);
    expect(asked).toBe(2);
  });

  it("hands fetch a URL with its own signal, never a Request", async () => {
    const calls: Call[] = [];
    vi.stubGlobal("fetch", network([ok()], calls));

    await operatorApi("tok").GET("/me", {});
    expect(typeof calls[0].input).toBe("string");
    expect(calls[0].init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(calls[0].init?.headers).get("authorization")).toBe(
      "Bearer tok",
    );
  });
});

describe("a write", () => {
  it("that goes quiet ends as a network error, and is never sent twice", async () => {
    vi.useFakeTimers();
    const calls: Call[] = [];
    vi.stubGlobal("fetch", network([null, ok()], calls));

    const write = operatorApi("tok")
      .POST("/team", { body: { phone: "+919000000101", name: "Arun" } })
      .then(
        () => null,
        (error: unknown) => error,
      );
    await vi.advanceTimersByTimeAsync(WRITE_STALL_MS);

    expect(await write).toBeInstanceOf(OperatorNetworkError);
    expect(calls).toHaveLength(1);
  });
});
