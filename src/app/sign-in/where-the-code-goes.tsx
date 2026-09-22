import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/site/contact";

/**
 * Where a code the operator asks for goes, said beside the button that asks.
 *
 * yuvoy-operator#91. The screen used to say nothing about the channel and let
 * its one hint do the implying: "It takes you straight to the code without
 * messaging your phone" told every operator that pressing the other button
 * messages their phone. It did not. There has never been a WhatsApp sender
 * (yuvoy-api#68), and since yuvoy-api 67e3213 every code goes to the email
 * address on the account instead, verified in production on 20 September.
 *
 * `POST /auth/otp` does not say which channel carried a particular code, and
 * cannot: it answers identically for a number we know and one we do not. So
 * this is said as where codes GO, which is true of every request, and never as
 * a claim that this one arrived. The operator with no email on the account is
 * the one who would otherwise wait for nothing, so the same line gives them
 * the way in that exists: a code from a person at Yuvoy (yuvoy-api#59), typed
 * in through "I already have a code" on sign-in, or into the code field that
 * `/signup` is already showing.
 *
 * Shared by both doors, and kept under `sign-in/` on purpose: `pnpm qa` §11c
 * reads every file in this folder and `/signup` for a promised phone or an
 * asserted send, and a copy of this sentence anywhere else would be outside
 * that guard.
 */
export function WhereTheCodeGoes({ id }: { id: string }) {
  return (
    <p id={id} className="text-forest/70 text-xs">
      We email the code to the address on your account. No email on it? Call us
      on{" "}
      <a
        href={SUPPORT_PHONE_HREF}
        className="text-terra-deep tap-target font-bold whitespace-nowrap underline underline-offset-4"
      >
        {SUPPORT_PHONE}
      </a>{" "}
      and we will give you one.
    </p>
  );
}
