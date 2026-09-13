import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";
import { signInPathFor } from "@/lib/auth/return-to";
import { SESSION_PATH_HEADER } from "@/proxy";

import { classifyMeFailure } from "@/lib/account/status";
import { standingOf, type Standing } from "@/lib/account/standing";

/**
 * The operator session: reading it, and deciding what it means.
 *
 * The token is opaque — the contract is explicit that it is "not a JWT and
 * carries no claims … random with no meaning outside our database, which is
 * what lets it be revoked and lets a stolen one be worthless once it is."
 * So there is nothing to decode, nothing to trust locally, and no expiry a
 * client can read. `GET /me` is the only honest answer to "am I signed in",
 * and a 401 from any call is the only honest answer to "am I still".
 *
 * This module only ever READS the cookie. The writers live in
 * `session-writes.ts`, importable only from `"use server"` modules, because a
 * cookie write from render throws in Next — see that file for the defect the
 * split closes. `pnpm qa` enforces the boundary.
 */

export const SESSION_COOKIE = "yvo_session";

export const SIGN_IN_PATH = "/sign-in";
export const ACCOUNT_PATH = "/account";

export async function readSessionToken(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Where to send somebody who has to sign in first — carrying where they were.
 *
 * The path comes from the proxy header (`src/proxy.ts`), because a Server Component cannot
 * read its own pathname and `Referrer-Policy: no-referrer` rules out the other
 * way of knowing. Absent for any reason at all — a request the matcher skips,
 * a header stripped somewhere — degrades to a plain `/sign-in`, which is what
 * this did before there was a return path. It is a nicety, and a nicety must
 * not be able to break the redirect it rides on.
 *
 * `signInPathFor` is what makes the value safe. It is request-controlled and
 * would otherwise be an open redirect fired at the moment somebody has just
 * signed in and is most inclined to trust the next page.
 */
async function signInRedirect(): Promise<string> {
  try {
    const jar = await headers();
    return signInPathFor(jar.get(SESSION_PATH_HEADER), SIGN_IN_PATH);
  } catch {
    return SIGN_IN_PATH;
  }
}

/**
 * `GET /me`, asked once per request however many things need the answer.
 *
 * Every authenticated page asks through `requireOperator()`, and since
 * yuvoy-operator#42 the root layout asks too, for the Business badge — so
 * without this a page paid for the same round trip twice on one bar of signal.
 * `cache` is request-scoped: a Server Action is its own request and still
 * reads the role at the moment of the tap, which is the property the actions
 * rely on.
 *
 * Errors are thrown, not returned, exactly as the call sites below already
 * expected — the error middleware in `server-client` raises them.
 */
export const readMe = cache(async (token: string) => {
  const { data, error } = await operatorApi(token).GET("/me", {});
  if (error) throw error;
  return data;
});

export interface OperatorIdentity {
  id: string;
  name: string;
  roles: string[];
  operatorId: string;
  /**
   * The business's own address on the traveller app — yuvoy-operator#41.
   *
   * `operators.slug` is `not null unique`, so the contract marks it required
   * and the API always sends it. Typed nullable here anyway: required in a
   * pinned contract is a promise about master, not about the deployed API, and
   * the one screen that reads it renders nothing rather than a link to
   * `/o/undefined`.
   */
  slug: string | null;
  /** OWNER or MANAGER. Capacity, earnings and call-off require it. */
  canManage: boolean;
  /**
   * Whether this account can sell, and what is outstanding — or `null` when
   * the API did not say.
   *
   * Carried on the identity every screen already has, so a screen that needs
   * to explain an empty day does not have to make a second `GET /me`. `null`
   * is "unknown", never "fine": the contract is explicit, and a screen that
   * treated an absent block as approval is exactly the bug this replaced.
   */
  account: Standing | null;
}

/**
 * What the cookie is actually worth, asked of the server.
 *
 * For the one page that must NOT bounce a cookie-holder onward on sight:
 * `/sign-in`. A cookie's existence says nothing — a session revoked an hour
 * ago leaves a cookie exactly as real as a live one — so the sign-in page
 * asks `GET /me` before deciding, and a dead cookie renders the form instead
 * of redirecting into a portal that will only send its holder straight back.
 */
export type SessionState =
  /** No cookie at all. */
  | "none"
  /** `/me` answered — the session is live. */
  | "alive"
  /** 403 `account_not_active` — signed in, but the business cannot trade. */
  | "not-active"
  /** 401 — the cookie outlived its session. Worthless, but still present. */
  | "dead"
  /** Network or server trouble: not an answer about the session at all. */
  | "unknown";

export async function sessionState(): Promise<SessionState> {
  const token = await readSessionToken();
  if (!token) return "none";
  try {
    await readMe(token);
    return "alive";
  } catch (err) {
    const status = classifyMeFailure(err);
    if (status === "signed-out") return "dead";
    if (status === "not-active") return "not-active";
    return "unknown";
  }
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
  if (!token) redirect(await signInRedirect());

  try {
    const data = await readMe(token);
    return {
      token,
      me: {
        id: data.id ?? "",
        name: data.name ?? "",
        roles: data.roles ?? [],
        operatorId: data.operatorId ?? "",
        slug: data.slug?.trim() || null,
        canManage: data.canManage ?? false,
        account: standingOf(data.account),
      },
    };
  } catch (err) {
    const status = classifyMeFailure(err);

    if (status === "signed-out") {
      /*
        The token is dead. It is deliberately NOT cleared here: this function
        runs during render, and Next only allows a cookie write inside a
        Server Action or Route Handler — the write throws, the throw pre-empts
        the redirect on the next line, and the operator is stranded on the
        error boundary holding the very cookie that keeps sending them there.
        That was a live defect: removing a staff member bricked their phone
        until the thirty-day cookie expired.

        The redirect loop the old clear guarded against is broken at the other
        end instead: `/sign-in` asks `sessionState()` rather than trusting
        that a cookie exists, so a dead cookie renders the sign-in form and
        the next successful sign-in overwrites it in the action phase, where
        writes are legal.
      */
      redirect(await signInRedirect());
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
