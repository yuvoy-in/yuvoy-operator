import { defineConfig, devices } from "@playwright/test";
import { MOCK_TUS_PORT } from "./mocks/tus-port";

/**
 * End-to-end configuration.
 *
 * Mobile is the primary project and desktop the secondary check, more firmly
 * than in the traveller app: the brief's operator is "standing on a jetty at
 * 6am on a phone, in bright sun, possibly with wet hands, on one bar of
 * signal", and a portal that only works on a laptop is a portal that gets used
 * from memory afterwards.
 *
 * `webServer` builds and serves rather than running `next dev`. The whole
 * portal is server-rendered through Server Actions, and dev-mode behaviour
 * around actions and revalidation is not what production does.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3200",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
  ],

  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        // Mocks stay ON. There is no staging operator API, and pointing e2e at
        // production would mark real travellers as no-shows.
        command: "pnpm build && pnpm start --port 3200",
        url: "http://127.0.0.1:3200/sign-in",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        /*
          `MOCK_TUS_ORIGIN` is read by `next.config.ts` into the CSP's
          `connect-src`. Without it the enforced policy blocks the browser's
          POST to the mock media host and both upload walkthroughs fail —
          which is exactly what happened on the first enforced run, and is the
          gate doing its job rather than a reason to loosen the policy.

          Kept in step with `MOCK_TUS_PORT` by importing it rather than
          retyping the number.
        */
        env: {
          NEXT_PUBLIC_API_MOCKING: "enabled",
          MOCK_TUS_ORIGIN: `http://127.0.0.1:${MOCK_TUS_PORT}`,
        },
      },
});
