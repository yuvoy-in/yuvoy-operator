import { vi } from "vitest";

/**
 * The whole unit suite, run again with the clock a week ahead
 * (`pnpm test:future`, part of `verify`).
 *
 * A test that holds a fixed moment against the real clock passes until the
 * day it does not: the offline replayer's kept writes were stamped
 * 4 Oct 2026 01:00 UTC, expire after a day, and failed every gate from
 * 5 Oct 06:30 IST. Run a week ahead, a test like that fails here a week
 * before it would break the gate for everybody. A suite that is right about
 * time passes either way, since every clock it reads moves together.
 *
 * First of the setup files (`vitest.config.mts`, behind VITEST_A_WEEK_AHEAD),
 * so the mocks' own clocks start from it too.
 * Only `Date` moves; timers and promises run as ever, and it keeps time.
 */
vi.useFakeTimers({
  toFake: ["Date"],
  now: Date.now() + 7 * 24 * 60 * 60 * 1000,
  shouldAdvanceTime: true,
});
