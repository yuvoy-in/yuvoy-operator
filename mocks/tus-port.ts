/**
 * Where the mock media host listens.
 *
 * Its own module so that `playwright.config.ts` can name the same port
 * without importing the server itself — the config is loaded before anything
 * is running, and pulling in `tus-server.ts` would drag a live HTTP server
 * into it.
 *
 * The config needs it because the enforced CSP's `connect-src` has to name
 * this origin, or the browser's POST to it is blocked and both upload
 * walkthroughs fail (yuvoy-operator#37).
 *
 * `pnpm dev` listens on the default. An e2e run starts there and takes the
 * first free port at or above it, then hands the server that number as
 * `MOCK_TUS_PORT`, so the CSP the build bakes and the upload URLs the server
 * mints name the same origin (yuvoy-operator#163). One number, no retyped
 * copy of it.
 */
export const DEFAULT_MOCK_TUS_PORT = 3201;

export const MOCK_TUS_PORT = Number(
  process.env.MOCK_TUS_PORT ?? DEFAULT_MOCK_TUS_PORT,
);
