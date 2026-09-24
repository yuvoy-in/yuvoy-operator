import type { NextConfig } from "next";
import { cspHeaders } from "./src/lib/site/csp";
import { assertNoSecretPublicVars } from "./src/lib/site/public-env";

/*
  Before anything is built: a public variable stored in Vercel as a Secret
  arrives here as "[SENSITIVE]" and would be inlined as that. Stop the build
  and name it instead. See src/lib/site/public-env.ts.
*/
assertNoSecretPublicVars();

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
  /**
   * The client router cache, switched on for a short window.
   *
   * Next 15 changed `staleTimes.dynamic` from 30s to **0**, and every route in
   * this portal is dynamic — so leaving a screen threw its payload away, and
   * coming back re-ran the whole server render. Home alone is seven reads.
   * Bouncing Home -> Bookings -> Home, which is most of what an operator does
   * with this thing, paid for all of it twice in about four seconds.
   *
   * **Five seconds, not the thirty the traveller app uses.** The numbers on
   * these screens are live seat counts, open requests with a clock on them,
   * and money. Five covers the gesture that actually feels broken — go in,
   * glance, come straight back — and is short enough that nobody can read a
   * seat count here, act on it, and be wrong.
   *
   * It is also well inside the freshness this portal already promises:
   * `RefreshOnFocus` re-reads the live screens on focus and otherwise every
   * 60 seconds, so a five-second window is an order of magnitude tighter than
   * the staleness those screens already tolerate by design. The reason it is
   * not simply set to 60 to match is that `RefreshOnFocus` refreshes on focus
   * and on an interval, never on mount — so a cached screen is only as fresh
   * as the cache that served it until the next tick.
   *
   * A Server Action that revalidates still clears this cache, so accepting a
   * request and landing back on the queue shows the answer immediately. The
   * window only ever covers a plain navigation.
   *
   * ## The other half of this fix now ships too
   *
   * A `loading.tsx` on every screen is what makes a tap paint in the first
   * frame, and what makes Next prefetch a dynamic route at all. It was built
   * on 19 September, pulled the same day, and is back — because the reason it
   * was pulled has been fixed rather than worked around.
   *
   * A boundary makes the route STREAM, and the status ships with the first
   * flushed byte, so a `redirect()` from inside the page runs too late.
   * Measured then, with a dead session cookie:
   *
   *     with a boundary:  /calendar /today /bookings  ->  200, no Location
   *     without one:      /earnings /team             ->  307 -> /sign-in
   *
   * The session is now resolved in the LAYOUT (`lib/auth/gate.ts`), which
   * renders above every boundary, so nothing has flushed when the redirect
   * fires. Re-measured with the boundaries in place: `/calendar` answers
   * `307 -> /sign-in?next=%2Fcalendar`, and so does every other screen.
   *
   * **The earlier note here recommended moving the check into middleware.
   * That was wrong** and is corrected rather than left for somebody to follow:
   * `pnpm qa` §13b fails the build if `src/proxy.ts` so much as mentions the
   * session cookie, and the reason is sound — middleware can only see that a
   * cookie EXISTS, and a session revoked an hour ago leaves a cookie exactly
   * as real as a live one. The layout gate is not that check: it calls the
   * same `requireOperator()` every page calls, so it moves WHEN the question
   * is asked, never WHO answers it.
   *
   * What a boundary still cannot sit above is a `notFound()`, which runs in
   * the page and has no layout to hoist it into. Those eight routes stay
   * unstreamed; `loading.test.ts` pins it.
   */
  experimental: {
    staleTimes: { dynamic: 5, static: 180 },
  },
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
      /*
        The Listings tab is gone: D-036, yuvoy-operator#56.

        Every listing is on the Business profile now, where it is made and
        mended (#58, #96), and the footage is that profile's Reels tab. The old
        URLs forward rather than 404: they are in operators' histories and in
        messages we have sent. Each goes straight to where it lands, one hop.
        307 like every other redirect here, because a tab structure this new
        is not settled enough to cache in somebody's browser forever.

        `/services/activities` and `/services/reels` are not here: their pages
        redirect themselves, to the same places, because the reels folder
        still holds the live uploaders and forms (the `page.tsx` under each).
      */
      {
        source: "/reels",
        destination: "/account?tab=reels",
        permanent: false,
      },
      { source: "/services", destination: "/account", permanent: false },
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
