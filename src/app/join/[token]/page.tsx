import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError } from "@/lib/api/errors";
import { JoinTokenForm } from "./join-token-form";
import { Screen } from "@/components/chrome/screen";

export const metadata: Metadata = { title: "Join a business" };

/*
  Force-dynamic like every other page here, and load-bearing rather than
  decorative: `OPERATOR_API_URL` is safe to mark Sensitive in Vercel only
  because it is read at REQUEST time. A page that prerenders could read it
  during the build and receive `[SENSITIVE]` — which killed yuvoy-app's first
  three production deploys. `pnpm qa` fails a page that omits this.
*/
export const dynamic = "force-dynamic";

/**
 * The link an owner sends — yuvoy-operator#23.
 *
 * ## One link per business, not one per invitation
 *
 * The same URL goes to everybody this business adds. It "grants nothing on its
 * own — the number must already have been invited", which is what makes it
 * safe to paste into a group chat, and why it can live permanently on the Team
 * screen rather than being minted per person.
 *
 * ## Why the business name is fetched before anything is typed
 *
 * "Somebody who is not yet a user has to see who is asking before handing over
 * a phone number." `GET /join/{token}` is unauthenticated and says which
 * business and nothing else — "whoever opened the link has not identified
 * themselves yet, so there is nobody to tell anything about."
 *
 * A bad token is `notFound()`, not an error: a link that does not work is not
 * a fault anybody here can act on, and the 404 page says so without inviting a
 * retry that can never succeed.
 */
export default async function JoinTokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let businessName: string | undefined;
  try {
    const { data, error } = await operatorApi().GET("/join/{token}", {
      params: { path: { token } },
    });
    if (error) throw error;
    businessName = data.businessName;
  } catch (err) {
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  return (
    <Screen nav="none" stageLabel="For operators" width="sm">
      <p className="eyebrow text-terra-deep">Yuvoy for operators</p>
      <h1 className="font-display tracking-display mt-4 text-4xl leading-[1.05]">
        Join {businessName ?? "this business"}
      </h1>
      {/*
        Says what the link is and what it is not. Somebody who received this in
        a forwarded message needs to know it will not work for them — before
        they type a number and find out.
      */}
      <p className="text-forest/70 mt-3 text-base">
        Enter the number you were invited on. This link only works for a number{" "}
        {businessName ?? "the business"} has already added.
      </p>

      <JoinTokenForm token={token} businessName={businessName} />

      <p className="border-cream-line text-forest/70 mt-10 border-t pt-6 text-sm">
        Already have an account here?{" "}
        <Link
          href="/sign-in"
          className="text-terra-deep tap-target font-bold underline underline-offset-4"
        >
          Sign in
        </Link>
        .
      </p>
    </Screen>
  );
}
