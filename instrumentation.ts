/**
 * Starts MSW inside the Next server.
 *
 * The whole portal is server-rendered — there is no browser API client here at
 * all — so this is the ONLY place mocking needs to happen, unlike the traveller
 * app which mocks both sides.
 *
 * Production never reaches this: the guard is a build-time flag and the import
 * is dynamic, so `mocks/` is not in the production graph.
 */
export async function register() {
  if (process.env.NEXT_PUBLIC_API_MOCKING !== "enabled") return;

  /*
    EXCLUDE edge rather than REQUIRE nodejs — the same trap yuvoy-app hit and
    documented. `NEXT_RUNTIME` is UNSET during `next build`'s static
    generation, so requiring "nodejs" silently skips MSW there and every
    server-side fetch fails while the build stays green. Excluding edge
    satisfies both: msw/node imports `async_hooks`, which edge does not have.
  */
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { startServerMocks } = await import("./mocks/start-server");
  await startServerMocks();
}
