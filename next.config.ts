import type { NextConfig } from "next";
import { cspHeaders } from "./src/lib/site/csp";

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
    /*
      Two CSP headers, deliberately — yuvoy-operator#37. A small enforced
      subset that cannot break a page that works today, and the full policy in
      report-only until a real run against `operators.yuvoy.in` says the
      enumeration is complete.

      The media hostnames are the reason that order matters here more than
      anywhere else: bytes go straight from the browser to the provider, the
      upload endpoint is minted per intent, and its subdomain is not something
      this repository can know. A guess that is wrong makes every upload fail
      silently, on the screens an operator needs most.

      See src/lib/site/csp.ts for the directive list and for why the API origin
      is deliberately NOT in `connect-src`.
    */
    const csp = cspHeaders({
      dev: process.env.NODE_ENV !== "production",
      /*
        Set by `pnpm dev` and by the e2e web server, and by no deployment.
        Honoured regardless of NODE_ENV because the e2e suite serves a
        PRODUCTION build — see `CspEnv.mockUploadOrigin` for why that is what
        makes the upload paths testable under an enforced policy at all.
      */
      mockUploadOrigin: process.env.MOCK_TUS_ORIGIN,
    });
    return [{ source: "/(.*)", headers: [...securityHeaders, ...csp] }];
  },
  /**
   * Where Manage services used to be — yuvoy-operator#22.
   *
   * `/reels` was a focused screen behind the Business door and is now half of
   * the Services section. Operators have the old URL in a browser history and
   * on at least one printed onboarding note, so it forwards rather than 404s.
   *
   * **307, not 308.** A permanent redirect is cached by the browser forever,
   * and this section is new enough that its shape may still move; a 308 held
   * on a phone would then point somewhere that no longer exists, with no way
   * to clear it remotely. The same call yuvoy-app made for its marketing
   * redirects. Promote after a season.
   */
  async redirects() {
    return [
      { source: "/reels", destination: "/services/reels", permanent: false },
      {
        source: "/services",
        destination: "/services/activities",
        permanent: false,
      },
      /*
        The two renamed tabs — yuvoy-operator#32.

        `Requests` became a section of `Bookings` once migration 0054 made
        `allotment` the default and the queue stopped being a destination;
        `Capacity` became `Calendar` because a calendar is what an operator
        thinks they are looking at and "capacity" is our word for the number
        inside it (D-031 C10).

        Both URLs are in operators' browser history and both have been sent in
        messages from us, so they forward rather than 404. **307, like the two
        above and for the same reason**: a permanent redirect is cached by the
        browser forever, and a tab structure two days old is not settled enough
        to bake into every phone that has ever visited. Promote after a season.
      */
      { source: "/requests", destination: "/bookings", permanent: false },
      { source: "/capacity", destination: "/calendar", permanent: false },
    ];
  },
};

export default nextConfig;
