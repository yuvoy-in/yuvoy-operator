import "server-only";
import createFetchClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema.gen";
import {
  OperatorApiError,
  OperatorNetworkError,
  apiError,
  isErrorEnvelope,
} from "./errors";

/**
 * The only place `/operator/v1` is called, and it runs on the SERVER ONLY.
 *
 * ## Why this cannot be a browser client
 *
 * `/operator/v1` refuses CORS by design. `yuvoy-api` applies CORS to the
 * public API only and skips it for `/operator/`, `/admin/`, `/hooks/` and
 * `/ops/`, with the reasoning written into the server: operator surfaces are
 * *"reached by their own apps through a same-origin server proxy … an admin
 * API that answers CORS is an admin API any page on the internet can attempt
 * to call with the user's cookies."*
 *
 * So a browser preflight from operators.yuvoy.in is **designed to fail**.
 * This is not a limitation to work around; it is the security model, and the
 * portal is built to fit it rather than to defeat it.
 *
 * ## What that buys, and what it costs
 *
 * The session token never reaches JavaScript. It lives in an httpOnly cookie
 * on this origin and is read here, on the server, one request at a time. An
 * XSS on this portal cannot steal a session it cannot see — a materially
 * better posture than the traveller app gets, and the reason there is no
 * client-side data layer in this repo at all.
 *
 * The cost is that every read is a server render and every write is a Server
 * Action. That is the whole architecture, and it is deliberate: there is no
 * generic `/api/operator/[...path]` proxy here, because a generic proxy with
 * the session attached hands the browser back exactly the surface the CORS
 * refusal removed. `pnpm qa` fails a route handler that is not allowlisted.
 */

const DEFAULT_BASE_URL = "http://localhost:8093/operator/v1";

/**
 * Describes a value without reproducing it.
 *
 * Vercel scrubs environment values out of build and function logs by literal
 * substitution, so echoing a bad value back prints `[SENSITIVE]` and says
 * nothing. Shape survives that: a length and a character census is enough to
 * recognise a stray quote, a pasted newline or a missing scheme.
 */
function describeShape(value: string): string {
  const unusual = [...new Set(value.replace(/[a-z0-9.\-/:]/g, ""))]
    .map((c) => {
      const code = c.codePointAt(0) ?? 0;
      return code < 0x20 || code > 0x7e
        ? `U+${code.toString(16).toUpperCase().padStart(4, "0")}`
        : c;
    })
    .join(" ");

  return (
    `length ${value.length}, ` +
    `scheme ${/^https?:\/\//i.test(value) ? "yes" : "no"}, ` +
    `whitespace inside ${/\s/.test(value) ? "yes" : "no"}, ` +
    `unusual characters: ${unusual ? `[ ${unusual} ]` : "none"}`
  );
}

/**
 * Where `/operator/v1` lives — read once, and **validated rather than trusted**.
 *
 * This pattern is here before it was needed, because it was needed next door.
 * `yuvoy-app` took `NEXT_PUBLIC_SITE_URL` on trust and three production
 * deploys died at module evaluation with `TypeError: Invalid URL` and a value
 * the log redacted. The local build had been green throughout — the variable
 * is unset locally, so the fallback literal was what ran.
 *
 * Three ways a dashboard value goes wrong, all handled here rather than deep
 * inside a fetch:
 *
 *   - **Empty string.** `??` does not catch it: `"" ?? x` is `""`. An env var
 *     created with no value is the easiest mistake there is to make.
 *   - **A trailing slash.** `${base}/slots` would become `//slots`, which is
 *     a protocol-relative URL and reaches a different host entirely.
 *   - **Not a URL at all.** Thrown, by name and by shape.
 *
 * Note this variable is deliberately NOT `NEXT_PUBLIC_`: nothing in this
 * portal talks to the API from a browser, so it has no business being inlined
 * into client JavaScript, and a leaked bundle should not name the admin
 * origin. It is read at request time, never at build time — every page here is
 * `force-dynamic` — so marking it Sensitive in Vercel is safe, unlike a
 * NEXT_PUBLIC_ value which the build must inline and therefore cannot.
 */
function resolveApiBaseUrl(): string {
  const raw = process.env.OPERATOR_API_URL?.trim().replace(
    /^["'`]|["'`]$/g,
    "",
  );
  const candidate = raw ? raw : DEFAULT_BASE_URL;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("not http");
    }
    // Trailing slash removed: openapi-fetch appends "/slots", and
    // `https://host/operator/v1//slots` is not the same request.
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(
      `OPERATOR_API_URL is not an http(s) URL. It must be a full base such ` +
        `as "https://api.yuvoy.in/operator/v1".\n` +
        `The value is masked in deploy logs, so here is its shape instead: ` +
        `${describeShape(candidate)}.`,
    );
  }
}

export function apiBaseUrl(): string {
  return resolveApiBaseUrl();
}

/**
 * Strips the fragment and query before a URL is handed to a logger.
 *
 * Same rule as the traveller app, for the same reason: this API logs request
 * URIs, and an id in a path is enough to correlate.
 */
function safePath(url: string): string {
  try {
    return new URL(url, "http://x").pathname;
  } catch {
    return url.split("#")[0].split("?")[0];
  }
}

const errorMiddleware: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return response;

    const requestId =
      response.headers.get("x-request-id") ??
      response.headers.get("X-Request-Id") ??
      undefined;

    let body: unknown = undefined;
    try {
      body = await response.clone().json();
    } catch {
      // A non-JSON error body is itself information — fall through.
    }

    if (isErrorEnvelope(body)) {
      throw apiError(body, response.status, requestId);
    }

    throw new OperatorApiError({
      code: "internal_error",
      message: `The server answered ${response.status}.`,
      status: response.status,
      requestId,
    });
  },
};

/* ------------------------------------------------------------------ retry */

/** Retry only these, and only on a GET. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_GET_ATTEMPTS = 3;

/**
 * Exponential backoff with full jitter.
 *
 * Jitter earns its place here for a reason the traveller app also has: a
 * squall closes a bay and every operator on Havelock opens the portal in the
 * same minute. Un-jittered backoff turns that into a synchronised stampede.
 */
export function backoffMs(attempt: number): number {
  const base = Math.min(300 * 2 ** attempt, 4_000);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET-only retry.
 *
 * A blind POST replay here does not double-charge anybody, but it can mark a
 * no-show twice or send a relay message twice — and a traveller who gets the
 * same "meeting point moved" message four times learns to ignore the next
 * one. Attendance is idempotent server-side for `arrived` specifically; the
 * terminal outcomes are not, so nothing is replayed automatically.
 */
function retryingFetch(input: Request): Promise<Response> {
  const isGet = input.method === "GET";

  const attempt = async (n: number): Promise<Response> => {
    let res: Response;
    try {
      res = await fetch(isGet ? input.clone() : input);
    } catch (cause) {
      if (isGet && n < MAX_GET_ATTEMPTS - 1) {
        await sleep(backoffMs(n));
        return attempt(n + 1);
      }
      throw new OperatorNetworkError(cause);
    }

    if (!isGet || res.ok || n >= MAX_GET_ATTEMPTS - 1) return res;
    if (!RETRYABLE_STATUS.has(res.status)) return res;

    await sleep(backoffMs(n));
    return attempt(n + 1);
  };

  return attempt(0);
}

/* ----------------------------------------------------------------- client */

/**
 * A client bound to one operator's session.
 *
 * The token is passed in rather than read here, so this module has no opinion
 * about where a session lives and the cookie handling stays in one place —
 * `lib/auth/session.ts`. An unauthenticated client (for `/auth/*`) is built
 * by passing nothing.
 */
export function operatorApi(sessionToken?: string) {
  const client = createFetchClient<paths>({
    baseUrl: apiBaseUrl(),
    fetch: retryingFetch as typeof fetch,
    headers: {
      "Content-Type": "application/json",
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    /*
      Nothing on this portal may be cached by Next's data cache. A manifest is
      the live answer to "who is standing in front of me", and a cached one is
      the specific failure the brief warns about: a manifest kept from memory
      that disagrees with the boat.
    */
    cache: "no-store",
  });

  client.use(errorMiddleware);
  return client;
}

export { safePath };
