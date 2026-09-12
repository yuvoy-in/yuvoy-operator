import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "./sign-in-form";
import { ACCOUNT_PATH, sessionState } from "@/lib/auth/session";
import { HOME_PATH, safeReturnPath } from "@/lib/auth/return-to";
import { Screen } from "@/components/chrome/screen";

export const metadata: Metadata = { title: "Sign in" };

/*
  Never cached and never prerendered: it reads a cookie to decide whether to
  redirect, and a cached sign-in page served to somebody already signed in is
  a dead end they have to work out for themselves.
*/
export const dynamic = "force-dynamic";

/** O2 — daily access for the person running the boat, one hand free. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  /*
    Where they were heading before their session ran out (yuvoy-operator#18).

    Validated here as well as at the redirect, because this value arrives in a
    URL anybody can send an operator — it is not the one this portal put there
    a moment ago. `safeReturnPath` bounds it to eight known routes on this
    origin; everything else becomes `null` and the flow behaves as it did
    before there was a return path.
  */
  const next = safeReturnPath((await searchParams).next);
  /*
    Asked of the server, not inferred from the cookie's existence. A session
    revoked an hour ago leaves a cookie exactly as real as a live one, and
    bouncing its holder to /today on sight built a loop: /today's
    requireOperator() sent them back here, and here sent them to /today,
    forever — with no legal place to clear the cookie, because clearing
    during render throws. A dead or unreadable session renders the form
    instead; the next successful sign-in overwrites the cookie in the action
    phase, where writes are allowed.

    "unknown" (network trouble, a 500) also renders the form: signing in
    again is harmless, while an error page here traps somebody on a jetty
    whose session may be fine.
  */
  const state = await sessionState();
  // Already signed in and back on the bookmark: straight through, and to the
  // page they were reaching for if there was one.
  if (state === "alive") redirect(next ?? HOME_PATH);
  if (state === "not-active") redirect(ACCOUNT_PATH);

  return (
    <Screen nav="none" stageLabel="For operators" width="sm">
      <p className="eyebrow text-terra-deep">Yuvoy for operators</p>
      <h1 className="font-display tracking-display mt-4 text-4xl leading-[1.05]">
        Sign in
      </h1>
      {/*
        Deliberately says nothing about HOW the code reaches you.

        `yuvoy-api#59` adds a second path: Yuvoy staff can issue a sign-in
        code out of band, which is the hedge for an operator whose phone is
        gone or whose WhatsApp has not arrived. The session it produces is
        indistinguishable from a WhatsApp one — `POST /auth/session` never
        learns which channel the code came from — and the ruling was that
        this copy should be true of both, **unconditionally**.

        Unconditional is the important half. A screen that says "we messaged
        you" only when it believes it did is a screen that has been told the
        channel, and being told is exactly what the design avoids.
      */}
      <p className="text-forest/70 mt-3 text-base">
        No password. You sign in with a one-time code for your business.
      </p>
      <SignInForm next={next} />

      {/*
        The way in for somebody who does not have an account yet — now a
        screen in this portal rather than a link off it.

        It pointed at `yuvoy.in/operators` until 5 Sep 2026, on the reasoning
        that signup was a marketing surface: the only endpoint was
        `POST /v1/operator-applications`, which files an application for a
        human to read. `POST /operator/v1/auth/signup` (D-029) is a different
        thing on a different contract — it creates a real account with a real
        session — so the form now lives where the account does.
        See yuvoy-operator#2.
      */}
      {/*
        The other door. Somebody invited to an existing business has a code
        but no account yet, and typing it into the sign-in form above would
        fail with a message about a code that "did not work" — which is true
        and useless. O5's accept flow is a different endpoint and mints no
        session, so it gets its own page.
      */}
      <p className="border-cream-line text-forest/70 mt-10 border-t pt-6 text-sm">
        Been invited to join a business?{" "}
        <Link
          href="/join"
          className="text-terra-deep tap-target font-bold underline underline-offset-4"
        >
          Accept your invitation
        </Link>
        . You accept first, then sign in here.
      </p>

      <p className="text-forest/70 mt-4 text-sm">
        Not on Yuvoy yet?{" "}
        <Link
          href="/signup"
          className="text-terra-deep tap-target font-bold underline underline-offset-4"
        >
          Create an account
        </Link>
        . You can sign in straight away. A person at Yuvoy checks your business
        over before travellers can book you.
      </p>
    </Screen>
  );
}
