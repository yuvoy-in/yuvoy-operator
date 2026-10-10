import { server } from "./server";
import { startMockTusServer } from "./tus-server";

let started = false;

/**
 * Idempotent: Next re-runs `instrumentation.register()` across a hot reload.
 */
export async function startServerMocks(): Promise<void> {
  if (started) return;
  started = true;
  server.listen({ onUnhandledRequest: "bypass" });
  /*
    O8's bytes go from the browser straight to the video provider, so the one
    request in this portal that MSW cannot intercept needs a real origin to
    talk to. Mock-only and unref'd. Awaited, so a port it cannot have is
    reported before this server answers anybody (yuvoy-operator#163).
  */
  await startMockTusServer();
}
