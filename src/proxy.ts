import { NextResponse, type NextRequest } from "next/server";

/**
 * The one thing this file does: tell the request what its own path is.
 *
 * `proxy.ts`, not `middleware.ts` — Next 16 deprecated the older convention
 * and warns on every build. Same request-interception point, same single job.
 *
 * ## Why this exists at all
 *
 * A Server Component cannot read the pathname it is rendering. `requireOperator()`
 * needs it for one reason — to put `?next=` on the sign-in redirect so an
 * operator bounced off a booking comes back to that booking rather than to
 * Today (yuvoy-operator#18). `Referrer-Policy` here is `no-referrer` and
 * deliberately so, which rules out the other way of knowing.
 *
 * ## What it must never become
 *
 * **This makes no authorisation decision, and it must never make one.**
 * `requireOperator()` says why: this layer can only see that a cookie EXISTS,
 * and a cookie whose session was revoked an hour ago exists exactly as hard as
 * a good one. The only thing that knows is the server, so every page asks it.
 * A cookie check here would look like security and be a redirect somebody can
 * hold a dead session past.
 *
 * It also reads no cookie, writes no cookie, and calls nothing. It sets one
 * request header and gets out of the way — `pnpm qa` fails this file
 * mentioning the session cookie, `next/headers`, or the API client, because a
 * file that runs before every request is the most attractive place in the
 * repository to put a shortcut.
 */
export const SESSION_PATH_HEADER = "x-yuvoy-path";

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);

  /*
    Path and query, which is what a return needs — a manifest filter is part of
    where somebody was. It is validated at the point of use by `safeReturnPath`
    rather than here: this value is request-controlled, and the check belongs
    next to the `redirect()` that could act on it, not a file away from it.
  */
  headers.set(
    SESSION_PATH_HEADER,
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );

  /*
    A header the CLIENT sent under this name would otherwise arrive looking
    like ours. It cannot reach anywhere dangerous — `safeReturnPath` bounds it
    to eight known routes — but a value that says "you are on /account" while
    rendering /payouts is a confusing lie, and overwriting rather than
    appending is what stops it.
  */
  return NextResponse.next({ request: { headers } });
}

export const config = {
  /*
    Everything except the things that are not pages. Static assets and the
    image optimiser never render a Server Component, so annotating them is
    work done on every request for nothing.
  */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)"],
};
