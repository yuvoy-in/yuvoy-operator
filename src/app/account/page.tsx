import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";
import { classifyMeFailure } from "@/lib/account/status";
import { readSessionToken, SIGN_IN_PATH } from "@/lib/auth/session";
import { SignOutButton } from "@/components/chrome/sign-out-button";

export const metadata: Metadata = { title: "Your account" };

export const dynamic = "force-dynamic";

/**
 * O3 — where an operator finds out whether they can trade, and who they are
 * waiting on.
 *
 * ## What this screen is not, and why
 *
 * O3 asks for the states between signing up and taking bookings, and for the
 * operator to see **exactly what is outstanding — a missing credential, an
 * unverified document — rather than a generic "pending"**. That is the right
 * screen and it is the one that stops the "why am I not live yet" phone call.
 *
 * **The pinned contract cannot answer it.** `GET /me` returns `id`, `name`,
 * `roles`, `operatorId` and `canManage`, and nothing else in the operator
 * document carries an account state, an approval stage, a credential or an
 * expiry. The single account-level signal that exists is a `403
 * account_not_active` — "suspended or offboarded".
 *
 * So this page says the one true thing the API publishes and **invents
 * nothing**. A checklist reading "waiting on your dive licence" would be
 * plausible, would look like the prototype, and would be a sentence an
 * operator plans a season around. Raised on yuvoy-api instead.
 *
 * ## Why it does not call `requireOperator()`
 *
 * That helper redirects here on `account_not_active`. Calling it from this
 * page would redirect to this page, forever. This is the one authenticated
 * screen that reads `GET /me` itself.
 */
export default async function AccountPage() {
  const token = await readSessionToken();
  if (!token) redirect(SIGN_IN_PATH);

  let active = false;
  try {
    const { error } = await operatorApi(token).GET("/me", {});
    if (error) throw error;
    active = true;
  } catch (err) {
    const status = classifyMeFailure(err);
    if (status === "signed-out") redirect(SIGN_IN_PATH);
    /*
      Anything that is not a known account state is thrown, deliberately. A
      dropped connection on a jetty must never render as "your account has
      been suspended" — the error boundary says something recoverable, and
      offers the retry that is actually the answer.
    */
    if (status !== "not-active") throw err;
  }

  return (
    <main className="bg-cream text-forest min-h-dvh">
      <div className="container-page max-w-2xl py-8">
        <div className="flex items-start justify-between gap-4">
          <p className="eyebrow text-terra-deep">Yuvoy for operators</p>
          <SignOutButton />
        </div>

        {active ? (
          <>
            <h1 className="font-display tracking-display mt-6 text-4xl leading-[1.05]">
              Your account is live
            </h1>
            <p className="text-forest/70 mt-3 text-base">
              Travellers can book your departures. Nothing is waiting on you
              here.
            </p>
            <Link
              href="/today"
              className="rounded-edge dock-target label bg-forest text-cream mt-8 flex items-center justify-center px-5 font-bold"
            >
              Go to today
            </Link>
            {/*
              Said out loud rather than left as a silence. An operator who came
              here expecting a review checklist should learn that we do not
              have one yet, not conclude that everything is approved because a
              page was blank.
            */}
            <p className="border-cream-line text-forest/70 mt-10 border-t pt-6 text-sm">
              We cannot yet show a breakdown of what Yuvoy has verified —
              licences, documents and their expiry dates are not on this screen
              because the API does not publish them. If you are waiting on a
              check, message us and a person will tell you where it is.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display tracking-display mt-6 text-4xl leading-[1.05]">
              Your account cannot take bookings
            </h1>
            {/*
              The contract's own distinction, kept: "the person is fine, the
              business relationship is not". So they are NOT signed out, and
              the page does not talk to them as though they had done something
              wrong. It also does not guess between suspended and offboarded —
              one code covers both, and inventing which would be worse than
              saying neither.
            */}
            <p className="text-forest/80 mt-3 text-base">
              Your sign-in works. It is the business account that is on hold, so
              departures are not on sale and bookings cannot be taken.
            </p>
            <p className="text-forest/80 mt-3 text-base">
              We have not told you why here, because this screen does not know.
              A person at Yuvoy does — that is the conversation to have.
            </p>

            <div className="rounded-edge border-terra-deep bg-cream-deep mt-8 border-2 p-5">
              <p className="text-base font-bold">Call us</p>
              <p className="mt-1.5 font-mono text-lg">+91 81216 57657</p>
              <p className="text-forest/70 mt-2 text-sm">
                If you have travellers booked on departures today, say so first.
                Those bookings still exist and still need somebody to meet them.
              </p>
            </div>

            <p className="text-forest/70 mt-8 text-sm">
              Nothing else in the portal will open while the account is on hold.
              Signing out and back in will not change it.
            </p>
          </>
        )}
      </div>
    </main>
  );
}
