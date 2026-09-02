import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "./sign-in-form";
import { readSessionToken } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Sign in" };

/*
  Never cached and never prerendered: it reads a cookie to decide whether to
  redirect, and a cached sign-in page served to somebody already signed in is
  a dead end they have to work out for themselves.
*/
export const dynamic = "force-dynamic";

/** O2 — daily access for the person running the boat, one hand free. */
export default async function SignInPage() {
  if (await readSessionToken()) redirect("/today");

  return (
    <main className="bg-cream text-forest flex min-h-dvh flex-col">
      <div className="container-page mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-12">
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
        <SignInForm />

        {/*
          The way in for somebody who does not have an account yet.
          Deliberately a LINK rather than a second form: applying posts to the
          public contract, the applicant has no session, and yuvoy.in/operators
          already does it. Two forms against one endpoint means two copies of
          the validation and two places that have to stay truthful about what
          applying means. See yuvoy-operator#2.
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
          <a
            href="https://yuvoy.in/operators"
            className="text-terra-deep tap-target font-bold underline underline-offset-4"
          >
            Apply to run experiences
          </a>
          . A person reads every application — nothing is public until we have
          checked you out.
        </p>
      </div>
    </main>
  );
}
