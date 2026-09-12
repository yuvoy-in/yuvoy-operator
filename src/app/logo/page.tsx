import type { Metadata } from "next";
import { readShape } from "@/lib/account/read-shape";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";
import { LogoUploader } from "./logo-uploader";

export const metadata: Metadata = { title: "Your logo" };
export const dynamic = "force-dynamic";

/**
 * The mark a business goes live with — yuvoy-operator#35 §2, #33.
 *
 * `LOGO_MISSING` has been on the Business screen's blocker list since that
 * screen existed, and it was a dead end: the operator could read that a logo
 * is mandatory before they can be booked, and their only route to one was to
 * ring us and have somebody do it from the admin console. That is exactly the
 * concierge path the self-serve portal was built to remove.
 *
 * A focused screen behind Business, so an operator arrives here from the
 * blocker and goes back to it.
 */
export default async function LogoPage() {
  const { token } = await requireOperator();

  /*
    Soft-failing. The uploader is the subject of this screen and works without
    knowing what is already there; a failed read costs the preview and the
    "replace" wording, not the ability to set a logo. An operator whose
    account is blocked on a missing logo must not be stopped by a read.
  */
  const current = await operatorApi(token)
    .GET("/logo", {})
    /*
      `readShape` because the contract declares a `202` on this GET whose body
      is the "recorded for review" acknowledgement, not a logo — see
      src/lib/account/read-shape.ts. A read cannot record anything for review,
      so that shape is treated as "nothing to show" rather than rendered.
    */
    .then((r) => (r.error ? null : readShape(r.data)))
    .catch(() => null);

  /*
    "`logoUrl` is absent when there is no logo, and ALSO when image hosting is
    unavailable — a blank string could not tell those apart." So a missing URL
    is never rendered as "you have no logo": `imageId` is what says one exists,
    and the two are shown apart.
  */
  const hasLogo = Boolean(current?.imageId);
  const logoUrl = current?.logoUrl;

  return (
    <Screen
      nav={{ back: { href: "/account", label: "your business" } }}
      stageLabel="Your logo"
    >
      <p className="eyebrow text-terra-deep">Your account</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Your logo
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Travellers see it on a card with no clip, and on the page about your
        business. We need one before you can be booked.
      </p>

      <Panel className="mt-8">
        {hasLogo ? (
          <div className="flex items-center gap-4">
            {logoUrl ? (
              /*
                A plain `<img>` for the same reason the traveller app's card
                uses one: `next/image` needs every remote host in
                `remotePatterns`, which would make adding an image host a
                deploy.
              */
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt="Your logo"
                className="bg-cream-deep size-20 rounded-full object-contain"
              />
            ) : null}
            <div className="min-w-0">
              <p className="text-base font-bold">You have a logo</p>
              <p className="text-forest/70 mt-1 text-sm">
                {logoUrl
                  ? "This is what travellers see."
                  : /*
                      An `imageId` with no URL is the second of the contract's
                      two absences, and it is not the operator's problem. Said
                      as a fact about us rather than as a doubt about their
                      file.
                    */
                    "We hold one, and cannot show it to you just now. Nothing is wrong with it."}
              </p>
            </div>
          </div>
        ) : (
          <p className="text-base font-bold">You have not set one yet</p>
        )}

        <div className="mt-6">
          <LogoUploader hasLogo={hasLogo} />
        </div>
      </Panel>

      <p className="text-forest/70 mt-8 text-sm">
        A logo is the one thing here you can change whenever you like. It is
        presentation, not identity, and nothing is verified against it.
        Replacing it removes the old picture rather than keeping both.
      </p>
    </Screen>
  );
}
