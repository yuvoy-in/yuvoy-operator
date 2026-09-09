/**
 * Content-Security-Policy for the operator portal — yuvoy-operator#37.
 *
 * ## Why this one matters
 *
 * The portal holds an OPERATOR SESSION. An injected script — a dependency
 * that turns bad, a compromised script host — can act as that operator:
 * change where their money is paid, cancel departures, accept bookings. A
 * stolen traveller token exposes one booking; this exposes a business.
 *
 * `connect-src` is the load-bearing directive, as it was on the admin console:
 * it is what leaves an injected script nowhere to send a stolen session.
 *
 * ## The interesting difference from the traveller app
 *
 * **The API host is NOT in `connect-src`, and that is correct.** Nothing in
 * this portal talks to the API from a browser — `/operator/v1` refuses CORS by
 * design, `server-client.ts` is `import "server-only"`, and `OPERATOR_API_URL`
 * is deliberately not `NEXT_PUBLIC_`. Naming the API origin here would publish
 * it in a header on every response, which is the same leak that keeping the
 * variable server-only exists to prevent.
 *
 * What the BROWSER does reach is the media hosts: bytes never pass through our
 * API, so the reel uploader speaks tus and the photograph and logo uploaders
 * POST multipart, each straight to the provider. Those are the only
 * cross-origin requests this portal makes, and the exact hostnames are
 * deployment-dependent — which is the single strongest argument for a
 * report-only run before enforcement rather than a policy written from
 * reading the code.
 *
 * ## Why there is no nonce
 *
 * The documented Next shape is a per-request nonce from `middleware.ts`. A
 * page only learns its nonce by reading `headers()`, which opts the route out
 * of static rendering — every page here is already `force-dynamic`, so that
 * cost would be nil, but the benefit is nil too: Next still emits its own
 * inline bootstrap, and adding a nonce or a hash to `script-src` makes the
 * browser IGNORE `'unsafe-inline'`, so every inline script would have to carry
 * it. That is a real change to how every page renders, for the directive that
 * is not the one carrying the weight here.
 *
 * So `script-src` keeps `'unsafe-inline'`, and the honest statement is: this
 * does not stop a script running, it stops one sending anything anywhere.
 * `'unsafe-inline'` in `script-src` weakens nothing else in this policy.
 *
 * ## Rollout — now enforced
 *
 * Shipped report-only on 9 Sep 2026 and enforced the same day, on the owner's
 * call, against evidence rather than a waiting period.
 *
 * The evidence is `pnpm verify` run with this policy ENFORCED: 342 end-to-end
 * tests drive the real production build in a real browser, across every screen
 * in the portal including both media uploaders, the manifest, the bank-change
 * flow and every role gate. A directive that blocks anything they touch fails
 * the suite rather than an operator on a boat.
 *
 * **What it does not cover, and it is the same gap the issue warned about.**
 * The suite runs against MSW plus a local tus server on loopback, so no upload
 * ever reaches Cloudflare. `MEDIA_HOSTS` is written from the contract and from
 * every call site rather than from watching one succeed, which is why each
 * entry is a subdomain wildcard rather than an exact URL — the upload endpoint
 * is minted per intent and its subdomain is not ours to predict.
 *
 * The report-only header therefore stays alongside the enforced one, carrying
 * the SAME policy. An enforced-only header blocks silently; report-only is
 * what puts a line in the console naming the directive that did it. First
 * real upload after this deploys is the thing to watch.
 */

/** An origin, or nothing when the URL is unusable. Never a path. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Where the browser sends bytes, and where it reads pictures back from.
 *
 * Cloudflare Stream for clips and Cloudflare Images for photographs and
 * logos. Subdomain wildcards rather than exact hosts because the upload
 * endpoint is minted per intent and its subdomain is not ours to predict — a
 * report-only run against production is what narrows these.
 */
const MEDIA_HOSTS = [
  "https://*.cloudflarestream.com",
  "https://videodelivery.net",
  "https://*.videodelivery.net",
  "https://imagedelivery.net",
  "https://*.imagedelivery.net",
];

export interface CspEnv {
  /** Development runs the mock upload host on loopback, and HMR on a socket. */
  dev?: boolean;
  /**
   * The mock media host, when one is running. Loopback, and set only by
   * `pnpm dev` and by the e2e web server.
   *
   * Honoured **regardless of `dev`**, which is the difference between a gate
   * that covers uploads and one that cannot. The e2e suite builds and serves
   * a PRODUCTION build — that is the whole point of it — so `dev` is false
   * there, and without this the enforced `connect-src` blocks the browser's
   * POST to the mock host and both upload walkthroughs fail. They did, on the
   * first enforced run, which is the gate working: the same directive would
   * block a real upload if `MEDIA_HOSTS` were wrong.
   *
   * It cannot widen production. The variable is set by no deployment, and an
   * unparseable value is dropped rather than emitted.
   */
  mockUploadOrigin?: string;
}

export function cspDirectives(env: CspEnv): string[] {
  const mock = originOf(env.mockUploadOrigin);

  const connect = [
    "'self'",
    ...MEDIA_HOSTS,
    ...(mock ? [mock] : []),
    // Next's dev server talks HMR over a websocket to the same host.
    ...(env.dev
      ? ["ws:", "wss:", "http://127.0.0.1:*", "http://localhost:*"]
      : []),
  ];

  return [
    // Fails closed: a directive nobody thought of inherits 'none'.
    `default-src 'none'`,
    `script-src 'self' 'unsafe-inline'${env.dev ? " 'unsafe-eval'" : ""}`,
    // Next sets inline styles, and so does every poster tile that carries a
    // `background-image`. A style is not a script.
    `style-src 'self' 'unsafe-inline'`,
    // Posters for clips, and the logo. `data:` for `next/image` placeholders.
    `img-src 'self' data: blob: ${MEDIA_HOSTS.join(" ")}`,
    // Self-hosted through `next/font/local`. No font CDN, deliberately.
    `font-src 'self'`,
    `connect-src ${connect.join(" ")}`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    // Nothing here is framed and nothing here frames anything.
    `frame-src 'none'`,
    /*
      `form-action 'self'` is doing real work in this app, not hygiene. Every
      write is a Server Action, which is a POST to this origin — so a
      rewritten `action` is how an injected script would send an operator's
      own form somewhere else, and it never touches `fetch`.
    */
    `object-src 'none'`,
    `base-uri 'none'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
}

/**
 * The whole policy is enforced.
 *
 * It was a three-directive subset for one day. Kept as its own function rather
 * than collapsed into `reportOnlyCsp` so that narrowing it again is a one-line
 * change with somewhere to put the reason — which is what it existed for, and
 * what it would be needed for if a report ever shows a directive too tight to
 * hold.
 */
export function enforcedCsp(env: CspEnv): string {
  return cspDirectives(env).join("; ");
}

export function reportOnlyCsp(env: CspEnv): string {
  return cspDirectives(env).join("; ");
}

export function cspHeaders(env: CspEnv): { key: string; value: string }[] {
  return [
    { key: "Content-Security-Policy", value: enforcedCsp(env) },
    { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp(env) },
  ];
}
