import type { Metadata } from "next";
import { SignUpForm } from "./signup-form";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = { title: "Create an account" };

export const dynamic = "force-dynamic";

/**
 * O1 — an operator creates their own account.
 *
 * ## Why this exists here now, when it did not before
 *
 * This issue was closed on 1 Sep on the reasoning that signup was a marketing
 * surface: the only endpoint was `POST /v1/operator-applications` on the
 * PUBLIC contract, which files an application for a human to read, and
 * `yuvoy.in/operators` already did that. `POST /operator/v1/auth/signup`
 * (D-029) is a different thing on a different contract — it creates a real
 * account with a real session, and the portal is where an account belongs.
 *
 * ## The one sentence this screen exists to prevent
 *
 * "I signed up and got no bookings, so Yuvoy is broken." A new account is
 * `PROSPECT` and cannot be booked by anybody until Yuvoy verifies it, so that
 * is said above the form, not in a footnote below it — and O3's `/account`
 * says the same thing again, with the detail, the moment they are inside.
 *
 * yuvoy-operator#20 asked for that reassurance to move into the portal. It
 * moved off the **confirmation panel**, which is gone: creating an account now
 * runs straight into the code step and then into `/today`. It stays here,
 * before the form, because this is the moment it prevents the
 * misunderstanding rather than explaining it afterwards — and the portal says
 * it again from `AccountStanding` the second they land.
 */
export default function SignUpPage() {
  return (
    <Screen>
      <p className="eyebrow text-terra-deep">Yuvoy for operators</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Create your account
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Your business, your name, and the number you will sign in with.
      </p>

      {/*
        Before the form, not after it. "Signing in is not being sellable" —
        an operator who believes otherwise waits for bookings that were never
        possible and concludes we are broken, which is the single most
        expensive misunderstanding this flow can create.
      */}
      <Panel className="mt-6 p-4">
        <p className="text-base font-bold">
          Creating an account does not put you on sale
        </p>
        <p className="text-forest/80 mt-2 text-sm">
          You can sign in straight away and get set up. Travellers cannot book
          you until somebody at Yuvoy has checked your business over. You will
          see exactly what is outstanding, and who it is with, as soon as you
          are in.
        </p>
      </Panel>

      <SignUpForm />
    </Screen>
  );
}
