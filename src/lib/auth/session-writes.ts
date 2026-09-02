import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";

/**
 * The two cookie writers, split from `session.ts` on purpose.
 *
 * Next only allows cookie mutation inside a Server Action or Route Handler —
 * the action phase. A write reached from a rendering Server Component throws,
 * and because the throw pre-empts whatever redirect sits beside it, the person
 * lands on the error boundary still holding the cookie that sent them there.
 * That was a live defect: `requireOperator()` cleared a dead session during
 * render, so a removed staff member's phone looped on "That did not load" for
 * as long as the thirty-day cookie lived.
 *
 * The split makes the rule structural rather than remembered: reads live in
 * `session.ts`, which any server module may import; writes live here, and
 * `pnpm qa` fails any import of this module from a file that is not a
 * `"use server"` action module.
 *
 * NOT itself marked `"use server"` — that would turn these exports into
 * public POST endpoints, and "set any cookie you like" is not an endpoint
 * this portal offers.
 */

/**
 * Thirty days, matching nothing in particular on purpose.
 *
 * The cookie's lifetime is a convenience; the SERVER decides whether a
 * session is alive. A cookie that outlives its session produces one 401 and a
 * redirect, which is correct. A cookie that dies first signs somebody out on
 * a jetty for no reason, which is not.
 */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * httpOnly is the load-bearing one and the reason this portal has no
 * client-side data layer: JavaScript on this origin cannot read the session,
 * so an XSS cannot carry it away.
 *
 * `sameSite: "lax"` rather than `strict`. Strict is tempting for an admin
 * surface, and it would sign an operator out of the first page they open from
 * a WhatsApp link — which is how they are told about a request waiting. Lax
 * still refuses to ride a cross-site POST, which is the attack that matters,
 * and Server Actions carry Next's own origin check on top.
 */
function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

export async function writeSessionToken(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, cookieOptions());
}

export async function clearSessionToken(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}
