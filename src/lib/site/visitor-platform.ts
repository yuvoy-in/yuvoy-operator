import "server-only";
import { headers } from "next/headers";
import { hostAppPlatform, type HostAppPlatform } from "./host-app";

/**
 * Which handoff to Yuvoy Host this request's browser gets, from its
 * User-Agent (yuvoy-operator#171).
 *
 * Its own module because `next/headers` is allowed only in modules
 * `scripts/qa.mjs` names, and `host-app.ts` is also imported by the client
 * claim screen. A request whose headers cannot be read gets the plain link,
 * the same posture as `visitorAddress()` in lib/api/visitor.
 */
export async function visitorPlatform(): Promise<HostAppPlatform> {
  try {
    return hostAppPlatform((await headers()).get("user-agent"));
  } catch {
    return "other";
  }
}
