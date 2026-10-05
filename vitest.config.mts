import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    /*
      `pnpm test:future` runs the same suite with the clock a week ahead, and
      that has to be first, so the mocks' own clocks start from it too. See
      test/a-week-ahead.ts.
    */
    setupFiles: [
      ...(process.env.VITEST_A_WEEK_AHEAD ? ["./test/a-week-ahead.ts"] : []),
      "./vitest.setup.ts",
    ],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // See test/server-only-stub.ts — a test run is not a build, and the
      // real enforcement lives in `next build` and `pnpm qa`.
      "server-only": fileURLToPath(
        new URL("./test/server-only-stub.ts", import.meta.url),
      ),
    },
  },
});
