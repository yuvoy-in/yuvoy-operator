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
 * ## Rollout
 *
 * Report-only first, then enforce. "A CSP that breaks the portal is worse than
 * none, because somebody disables it in a hurry and it never comes back."
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
  /** Only set in development, where the mock media host is on loopback. */
  mockUploadOrigin?: string;
}

export function cspDirectives(env: CspEnv): string[] {
  const mock = env.dev ? originOf(env.mockUploadOrigin) : null;

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
 * The subset enforced today.
 *
 * Nothing in the portal uses any of these capabilities — no `<object>`, no
 * `<base>`, and nothing frames it — so each can go on without a report. The
 * rest waits for a real report-only run against `operators.yuvoy.in`, because
 * the media hostnames above are the one thing that cannot be known from
 * reading the code.
 */
const ENFORCED = new Set(["object-src", "base-uri", "frame-ancestors"]);

export function enforcedCsp(env: CspEnv): string {
  return cspDirectives(env)
    .filter((d) => ENFORCED.has(d.split(" ")[0]))
    .join("; ");
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
