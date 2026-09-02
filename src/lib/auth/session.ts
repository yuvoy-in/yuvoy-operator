import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";

import { classifyMeFailure } from "@/lib/account/status";

/**
 * The operator session, and the one place the token is touched.
 *
 * The token is opaque — the contract is explicit that it is "not a JWT and
 * carries no claims … random with no meaning outside our database, which is
 * what lets it be revoked and lets a stolen one be worthless once it is."
 * So there is nothing to decode, nothing to trust locally, and no expiry a
 * client can read. `GET /me` is the only honest answer to "am I signed in",
 * and a 401 from any call is the only honest answer to "am I still".
 */

const COOKIE = "yvo_session";

/**
 * Thirty days, matching nothing in particular on purpose.
 *
 * The cookie's lifetime is a convenience; the SERVER decides whether a
 * session is alive. A cookie that outlives its session produces one 401 and a
 * redirect, which is correct. A cookie that dies first signs somebody out on
 * a jetty for no reason, which is not.
 */
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const SIGN_IN_PATH = "/sign-in";
export const ACCOUNT_PATH = "/account";

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

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}

export async function writeSessionToken(token: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, token, cookieOptions());
}

export async function clearSessionToken(): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, "", { ...cookieOptions(), maxAge: 0 });
}

export interface OperatorIdentity {
  id: string;
  name: string;
  roles: string[];
  operatorId: string;
  /** OWNER or MANAGER. Capacity, earnings and call-off require it. */
  canManage: boolean;
}

/**
 * The signed-in user, or a redirect to sign-in.
 *
 * Every authenticated page calls this first. It is not a middleware check:
 * middleware can only see that a cookie EXISTS, and a cookie whose session was
 * revoked an hour ago exists exactly as hard as a good one. The only thing
 * that knows is the server, so we ask it.
 */
export async function requireOperator(): Promise<{
  token: string;
  me: OperatorIdentity;
}> {
  const token = await readSessionToken();
  if (!token) redirect(SIGN_IN_PATH);

  try {
    const { data, error } = await operatorApi(token).GET("/me", {});
    if (error) throw error;
    return {
      token,
      me: {
        id: data.id ?? "",
        name: data.name ?? "",
        roles: data.roles ?? [],
        operatorId: data.operatorId ?? "",
        canManage: data.canManage ?? false,
      },
    };
  } catch (err) {
    const status = classifyMeFailure(err);

    if (status === "signed-out") {
      // The token is dead. Drop it rather than looping through a redirect
      // that hands the same dead token back on the next request.
      await clearSessionToken();
      redirect(SIGN_IN_PATH);
    }

    /*
      403 `account_not_active` — suspended or offboarded. The contract draws
      the line deliberately: the PERSON is fine, the business relationship is
      not, so the session is NOT cleared and they are not sent to sign in.

      It used to throw here, on the stated grounds that the error boundary
      would say what was actually true. There was no error boundary. In
      production Next also strips a thrown error's message and code before a
      boundary ever sees it, so that plan could not have worked even once one
      existed — a boundary can only ever say "something went wrong", which is
      the opposite of true here.

      The state is known at exactly this point, so it is handled at exactly
      this point: /account reads `GET /me` itself and says what it means.
    */
    if (status === "not-active") redirect(ACCOUNT_PATH);

    throw err;
  }
}
