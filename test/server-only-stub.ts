/**
 * A no-op stand-in for `server-only`, used by Vitest alone.
 *
 * `server-only` throws when resolved through a client condition, and Vitest's
 * jsdom environment resolves that way — so a unit test importing a server
 * module fails on the import rather than on anything it was testing.
 *
 * **This does not weaken the guard.** `server-only` is a build-time marker and
 * a test run is not a build: the real enforcement is `next build`, which still
 * fails if a client component reaches one of these modules, plus `pnpm qa`,
 * which fails the same thing earlier and names the import chain. Both run in
 * `pnpm verify`, on either side of this.
 */
export {};
