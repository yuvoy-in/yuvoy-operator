import { server } from "./server";

let started = false;

/**
 * Idempotent: Next re-runs `instrumentation.register()` across a hot reload.
 */
export async function startServerMocks(): Promise<void> {
  if (started) return;
  started = true;
  server.listen({ onUnhandledRequest: "bypass" });
}
