import type { Metadata } from "next";
import { readShape } from "@/lib/account/read-shape";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import { getChangeRequests } from "@/lib/money/fetch";
import { reviewNote, reviewOf } from "@/lib/account/review";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";
import { ReviewPanel } from "@/components/account/review-panel";
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
  const { token, me } = await requireOperator();

  /*
    Soft-failing. The uploader is the subject of this screen and works without
    knowing what is already there; a failed read costs the preview and the
    "replace" wording, not the ability to set a logo. An operator whose
    account is blocked on a missing logo must not be stopped by a read.
  */
  const [current, changes] = await Promise.all([
    operatorApi(token)
      .GET("/logo", {})
      /*
        `readShape` because the contract declares a `202` on this GET whose
        body is the "recorded for review" acknowledgement, not a logo: see
        src/lib/account/read-shape.ts. A read cannot record anything for
        review, so that shape is treated as "nothing to show" rather than
        rendered.
      */
      .then((r) => (r.error ? null : readShape(r.data)))
      .catch(() => null),
    /*
      Whether a new mark is waiting on us (yuvoy-operator#89 f10). Soft, like
      the read above: `[]` on failure, which says nothing rather than
      something false.
    */
    getChangeRequests(token),
  ]);

  /*
    "`logoUrl` is absent when there is no logo, and ALSO when image hosting is
    unavailable — a blank string could not tell those apart." So a missing URL
    is never rendered as "you have no logo": `imageId` is what says one exists,
    and the two are shown apart.
  */
  const hasLogo = Boolean(current?.imageId);
  const logoUrl = current?.logoUrl;
  const review = reviewNote(reviewOf(changes, "logo", current?.uploadedAt));

  return (
    <Screen
      nav={{ back: { href: "/account/settings", label: "settings" } }}
      stageLabel="Your logo"
    >
      <p className="eyebrow text-terra-deep">Your account</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Your logo
      </h1>
      {/*
        "We need one before you can be booked" used to close this sentence. It
        stopped being true with yuvoy-api#139, which took a missing logo off
        the list of things that stop a sale on a LIVE business. Whether it
        stops THIS business is on Business, which reads `gates` per blocker
        rather than guessing.
      */}
      <p className="text-forest/70 mt-3 text-base">
        Travellers see it on a card with no clip, and on the page about your
        business.
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
                className="bg-paper-deep size-20 rounded-full object-contain"
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

        {review ? (
          <div className="mt-6">
            <ReviewPanel note={review} subject="logo" hasCurrent={hasLogo} />
          </div>
        ) : null}

        <div className="mt-6">
          {me.canManage ? (
            <LogoUploader hasLogo={hasLogo} />
          ) : (
            /*
              Refused before the tap rather than after it. Both the upload slot
              and `PUT /logo` are OWNER, ADMIN or MANAGER only, so a staff
              login offered the file picker chose a picture, waited for it,
              and was then told their role could not do it.
            */
            <p className="text-forest/80 text-sm">
              Only an owner, an admin or a manager can change the logo. Ask one
              of them at your business.
            </p>
          )}
        </div>
      </Panel>

      {/*
        The one sentence that changes what somebody does: without it, an
        operator whose new mark has not appeared yet uploads it again.
      */}
      <p className="text-forest/70 mt-8 text-sm">
        Once your account is live, we look at a new logo before it replaces the
        one travellers see.
      </p>
    </Screen>
  );
}
