import "server-only";
import { isIP } from "node:net";
import { headers } from "next/headers";
import type { Middleware } from "openapi-fetch";

/**
 * The person's own address, for the API's per-IP limits (yuvoy-api#282
 * item 3, yuvoy-api#299).
 *
 * This portal calls the API only from its server, so without this every
 * per-IP limit counts Vercel: everybody asking for a sign-in code shares the
 * budget of the few addresses Vercel calls from, and a busy hour, or one
 * person on purpose, can use it up for every operator. The API believes
 * `X-Yuvoy-Client-IP` only beside an `X-Yuvoy-Proxy-Secret` matching its own
 * `PROXY_CLIENT_IP_SECRET`, and only as one bare IPv4 or IPv6 address;
 * anything else counts the calling server, as before.
 *
 * SET, never forwarded. The address is Vercel's `x-real-ip`, which Vercel
 * writes from the connection and overwrites when a caller sends one, never
 * `X-Forwarded-For`, which anybody can write and which would buy a fresh
 * budget per request. And both or neither: with no usable secret here no
 * address goes either, so a deployment without the variable sends exactly
 * what it always sent, and the request is not even read.
 *
 * The secret is server only (never `NEXT_PUBLIC_`), never logged, and goes
 * nowhere but the API. Neither header is in the API's CORS allow list, so a
 * page cannot send them itself. The same rules as the traveller app's
 * `visitorAddressHeaders`, which sends the same two headers.
 */
export function visitorAddressHeaders(
  visitor: Headers | null | undefined,
): Record<string, string> {
  const secret = proxySecret();
  if (!secret) return {};
  const address = visitor?.get("x-real-ip")?.trim();
  /*
    One bare address: `isIP` refuses a port, brackets and a list, and a zone
    (`fe80::1%en0`) is refused here, since `isIP` takes one and the API does
    not promise to.
  */
  if (!address || address.includes("%") || isIP(address) === 0) return {};
  return { "X-Yuvoy-Client-IP": address, "X-Yuvoy-Proxy-Secret": secret };
}

/**
 * The two headers for a call made while answering this request: a page, a
 * Server Action. Outside a request there is nobody to name, and nothing is
 * sent.
 */
export async function visitorAddress(): Promise<Record<string, string>> {
  if (!proxySecret()) return {};
  return visitorAddressHeaders(await requestHeaders());
}

/** Puts them on every call the generated client makes. */
export const visitorAddressMiddleware: Middleware = {
  async onRequest({ request }) {
    for (const [name, value] of Object.entries(await visitorAddress())) {
      request.headers.set(name, value);
    }
    return request;
  },
};

/*
  The same posture `signInRedirect()` takes in lib/auth/session: a request
  whose headers cannot be read sends no address rather than failing the call.
*/
async function requestHeaders(): Promise<Headers | undefined> {
  try {
    return await headers();
  } catch {
    return undefined;
  }
}

/**
 * The shared secret, when it is one the API would boot with: 32 or more
 * characters a header can carry. Anything else is sent as nothing, because a
 * header `fetch` cannot carry would fail every call to the API, and it is
 * said once in the log, by name only.
 */
function proxySecret(): string | null {
  const secret = process.env.PROXY_CLIENT_IP_SECRET;
  if (!secret) return null;
  if (/^[\x21-\x7E]{32,}$/.test(secret)) return secret;
  if (!warnedOfSecret) {
    warnedOfSecret = true;
    console.warn(
      "PROXY_CLIENT_IP_SECRET is not 32 or more visible characters, so no visitor address is sent to the API.",
    );
  }
  return null;
}
let warnedOfSecret = false;
