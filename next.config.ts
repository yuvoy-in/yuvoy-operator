import type { NextConfig } from "next";

/**
 * The operator portal is a higher-value target than the traveller app.
 *
 * A stolen traveller status token exposes one booking. A stolen operator
 * session exposes a business's whole customer list, its capacity and — via the
 * bank change flow — where its money goes. So the headers here are stricter
 * than the traveller app's in three specific ways, each noted below.
 */
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  /*
    `no-referrer`, not the traveller app's `strict-origin-when-cross-origin`.
    Every authenticated URL here carries an id — a slot, a booking — and there
    is no third party this portal needs to tell where somebody came from.
  */
  { key: "Referrer-Policy", value: "no-referrer" },
  /*
    DENY, not SAMEORIGIN. Nothing in this portal is ever framed, including by
    itself, and clickjacking an attendance button or a call-off confirmation
    is a real attack with a real cost.
  */
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  /*
    Nothing here may be stored by a shared cache, on any route. Every page is
    one operator's data behind a cookie, and a proxy that caches a manifest
    serves it to the next operator through the same proxy.
  */
  { key: "Cache-Control", value: "no-store, must-revalidate" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
