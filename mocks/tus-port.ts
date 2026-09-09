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
 * walkthroughs fail (yuvoy-operator#37). One constant, two readers, no
 * retyped number.
 */
export const MOCK_TUS_PORT = Number(process.env.MOCK_TUS_PORT ?? 3201);
