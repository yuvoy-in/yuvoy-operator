import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";
import { signInPathFor } from "@/lib/auth/return-to";
import { SESSION_PATH_HEADER } from "@/proxy";
import { isBareRoute } from "@/lib/site/nav";

import { classifyMeFailure } from "@/lib/account/status";
import {
  standingOf,
  suspensionOf,
  type Standing,
  type Suspension,
} from "@/lib/account/standing";

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
  /**
   * What Yuvoy keeps on a booking, in basis points — 1500 is 15%.
   *
   * The business's own contracted rate when it has one, the standard rate when
   * it has none. `null` when the API sent none: "absent where the service was
   * not given a standard rate", which is not a rate of zero and must not
   * render as one (yuvoy-operator#44).
   */
  commissionRateBps: number | null;
  /** OWNER, ADMIN or MANAGER. Capacity, earnings and call-off require it. */
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
  /**
   * Present exactly while the business is suspended, closed or disqualified
   * (yuvoy-operator#50), and absent otherwise.
   *
   * Carried on the identity beside `canManage` and for the same reason: every
   * screen that draws a write control already has this object, so deciding
   * whether to draw one costs no second read. A suspended business may still
   * make some writes and not others, so this is not a blanket "read only":
   * see `WRITES_ALLOWED_WHILE_SUSPENDED`.
   */
  suspension: NonNullable<Suspension> | null;
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
        commissionRateBps:
          typeof data.commissionRateBps === "number"
            ? data.commissionRateBps
            : null,
        canManage: data.canManage ?? false,
        account: standingOf(data.account),
        suspension: suspensionOf(data.account),
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
      403 `account_not_active` — an OFFBOARDED account, which cannot hold a
      session. The contract draws the line deliberately: the PERSON is fine,
      the business relationship is not, so the session is NOT cleared and they
      are not sent to sign in.

      It no longer covers a suspended business (yuvoy-operator#50). One of
      those signs in normally, gets a 200 here, and carries
      `account.suspension`, so it reaches the portal rather than this branch.
      That separation is the point: a suspended operator still has trips to run
      that travellers have paid for, and redirecting them to a single dead-end
      page would strand those travellers.

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

/**
 * Resolve the session in the LAYOUT, above every loading boundary.
 *
 * ## Why position is the entire point
 *
 * A `loading.tsx` makes its route stream, and the HTTP status ships with the
 * first flushed byte. A `redirect()` from inside the page therefore runs too
 * late to set one: measured on a production build with a dead session cookie,
 * every boundaried route answered **200 with no Location** where an
 * unboundaried one answered **307 -> /sign-in?next=...**. That is why the
 * boundaries were built, measured and pulled on 19 September, and why the
 * portal shipped with only half its navigation fix.
 *
 * A layout renders ABOVE the boundary it contains. Awaiting the session here
 * means nothing has flushed when `requireOperator()` redirects, so the 307
 * survives and the boundaries can stay. Verified: `/calendar` with a
 * `loading.tsx` present answers `307 -> /sign-in?next=%2Fcalendar`.
 *
 * ## Why this is not the middleware check, and must not become it
 *
 * `src/proxy.ts` is forbidden from making this decision, and `pnpm qa` §13b
 * fails the build if it tries. The reason is sound and unchanged: middleware
 * can only see that a cookie EXISTS, and a session revoked an hour ago leaves
 * a cookie exactly as real as a live one. This file is not that check. It runs
 * in the Node server render, calls `requireOperator()` — the same function
 * every page calls — and so asks the API the same question with the same
 * answer. It moves WHEN the question is asked, never WHO answers it.
 *
 * (An earlier note in `next.config.ts` recommended moving the check into
 * middleware. That recommendation was wrong, for the reason above, and has
 * been corrected rather than left for somebody to follow into a qa failure.)
 *
 * ## It costs nothing
 *
 * `readMe` is `cache()`d per request, and the layout already calls
 * `chromeData()` which reads the same `/me`. Every page still calls
 * `requireOperator()` for the token and identity it needs, and hits the same
 * memoised answer. This adds a call site, not a request.
 *
 * ## It is additive, never a replacement
 *
 * Pages keep their own `requireOperator()`. This is a second lock on the same
 * door: a page that somehow renders without one is still refused by its own
 * call. Nothing here may ever be the only thing standing between a signed-out
 * request and an operator's bookings.
 */
export async function gateSession(): Promise<void> {
  /*
    The three doors draw no chrome and must not be gated — sign-in redirecting
    to sign-in is an infinite loop, and `/join/<token>` is reached by somebody
    who has no session yet by definition.
  */
  let here: string | null = null;
  try {
    here = (await headers()).get(SESSION_PATH_HEADER);
  } catch {
    /*
      No header means the proxy matcher skipped this request, or something
      stripped it. Degrade to NOT gating: the pages still hold the door, and a
      gate that guesses is worse than one that stands aside. Same posture
      `signInRedirect()` takes when the header is missing.
    */
    return;
  }
  if (!here) return;

  const path = here.split("?")[0];
  // `/` is a redirect stub to /today and resolves before any session matters.
  if (path === "/" || isBareRoute(path)) return;

  /*
    `sessionState()`, NOT `requireOperator()`, and the difference is the whole
    correctness of this function.

    `requireOperator()` THROWS on a failure it cannot classify — a 500, a
    dropped connection. In a PAGE that is exactly right: the route's error
    boundary catches it and renders "That did not load" with a Try again, which
    is what somebody on a jetty at 0.5 Mbps needs. From a LAYOUT the same throw
    escapes that boundary entirely, and the retry screen is replaced by a
    generic failure. `account.spec.ts` calls that test "the single most
    important line in this file", and it caught this.

    So the gate acts on the two states that need a REDIRECT and stands aside
    for everything else. `unknown` falls through to the page, whose own
    `requireOperator()` throws into the boundary that can render it properly.
    `readMe` is `cache()`d, so asking here costs no extra request.
  */
  const state = await sessionState();

  if (state === "none" || state === "dead") redirect(await signInRedirect());
  if (state === "not-active") redirect(ACCOUNT_PATH);
}
