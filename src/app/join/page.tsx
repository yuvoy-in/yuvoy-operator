import type { Metadata } from "next";
import Link from "next/link";
import { JoinForm } from "./join-form";
import { Screen } from "@/components/chrome/screen";

export const metadata: Metadata = { title: "Accept an invitation" };

/*
  Force-dynamic like every other page here, and the invariant is load-bearing
  rather than decorative: `OPERATOR_API_URL` is safe to mark Sensitive in
  Vercel only because it is read at REQUEST time, never at build time. A page
  that prerenders is a page that could read it during the build and receive
  `[SENSITIVE]` — which is exactly what killed yuvoy-app's first three
  production deploys. `pnpm qa` now fails a page that omits this.
*/
export const dynamic = "force-dynamic";

/**
 * The other end of O5's invite.
 *
 * Public, because the person reading it has no account yet — that is the whole
 * reason `POST /team/accept` carries `security: []`. Deliberately not a
 * link-with-a-token: the code arrives in a message and is typed, so the page
 * works whether or not a link survived whatever app it was pasted into, and a
 * code in a URL is a code in a browser history and a server log.
 */
export default function JoinPage() {
  return (
    <Screen nav="none" stageLabel="For operators" width="sm">
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Accept an invitation
      </h1>
      {/*
        The one sentence that changes what somebody types: which code. "Somebody
        has added you to their business" explained the screen its heading
        already names (yuvoy-operator#80 t4).
      */}
      <p className="text-forest/70 mt-3 text-base">
        Enter your number and the code from your invitation.
      </p>

      <JoinForm />

      <p className="border-paper-line text-forest/70 mt-10 border-t pt-6 text-sm">
        Already accepted?{" "}
        <Link
          href="/sign-in"
          className="text-terra-deep tap-target font-bold underline underline-offset-4"
        >
          Sign in
        </Link>
        . Codes last seven days. If yours has expired, ask whoever invited you
        to send another.
      </p>
    </Screen>
  );
}
