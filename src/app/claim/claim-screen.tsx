import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Screen } from "@/components/chrome/screen";
import { ReadAgain } from "@/components/claims/read-again";
import { ButtonLink } from "@/components/ui/button";
import { buttonClass } from "@/components/ui/button-class";
import { Panel } from "@/components/ui/panel";
import { Problem } from "@/components/ui/states";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError } from "@/lib/api/errors";
import { signInPathFor } from "@/lib/auth/return-to";
import {
  ACCOUNT_PATH,
  requireOperator,
  sessionState,
} from "@/lib/auth/session";
import {
  claimPath,
  claimRoleLine,
  type ClaimPreview,
} from "@/lib/claims/claims";
import {
  CLAIM_SIGNED_OUT_LINE,
  CLAIM_TITLE,
  NO_LISTING_LINE,
  STORE_LINE,
} from "@/lib/claims/words";
import { sentence } from "@/lib/format/sentence";
import { canManageAccess } from "@/lib/team/access";
import { readBusinessName } from "@/lib/site/business-name";
import {
  HOST_APP_STORES,
  openInAppLink,
  type HostAppPlatform,
} from "@/lib/site/host-app";
import { ClaimForm } from "./claim-form";

/**
 * `operators.yuvoy.in/claim/{slug}`: the claim itself (yuvoy-operator#388,
 * the web half of yuvoy-mobile#388). It replaced the store page of
 * yuvoy-operator#171, which made no call and never named the listing; the
 * stores stay as a line under the claim, for a phone that would rather use
 * the app. `/claim/*` is not in this host's link files yet
 * (`apple-app-site-association` lists no claim path), so today this page
 * serves every phone as well as computers; once the path is listed, a phone
 * with Yuvoy Host hands the link to the app and this never draws there.
 *
 * Still a bare route (`BARE_ROUTE_PREFIXES`): the person who taps "Claim in
 * Yuvoy Host" in the traveller app may have no account yet. So it reads the
 * session itself, in the order the sign-in page does:
 *
 *   - **Signed out, or a dead cookie.** The listing's name needs a session,
 *     so the door names none: "Sign up or sign in to claim this listing", and
 *     both doors carry `next` back to this link (`/claim` is in the return
 *     allowlist).
 *   - **An offboarded business** goes to `/account`, as everywhere.
 *   - **A session nobody could read** (network, a 500) is a read that
 *     failed, with Try again.
 *   - **Signed in.** The listing is read (`GET /listing-claims/preview`): a
 *     removed or unknown listing, or the directory switched off (`404`,
 *     `400`), is the API's sentence with no retry; anything else is Try
 *     again. Then the claim (`ClaimForm`), with who can claim for MANAGER
 *     and STAFF.
 *
 * With no slug at all there is nothing to read or open: "There is no listing
 * to claim here." and the stores, on any phone.
 */
export async function ClaimScreen({
  slug,
  platform,
}: {
  slug: string | null;
  platform: HostAppPlatform;
}) {
  if (!slug) {
    return (
      <ClaimChrome>
        <Heading />
        <NoListing />
        <StoreLine slug={null} platform={platform} />
      </ClaimChrome>
    );
  }

  const session = await sessionState();
  if (session === "none" || session === "dead") {
    return (
      <ClaimChrome>
        <SignedOut slug={slug} />
        <StoreLine slug={slug} platform={platform} />
      </ClaimChrome>
    );
  }
  if (session === "not-active") redirect(ACCOUNT_PATH);
  if (session === "unknown") {
    return (
      <ClaimChrome>
        <Heading />
        <ReadFailed />
        <StoreLine slug={slug} platform={platform} />
      </ClaimChrome>
    );
  }

  const { token, me } = await requireOperator();
  let listing: ClaimPreview;
  try {
    const { data, error } = await operatorApi(token).GET(
      "/listing-claims/preview",
      { params: { query: { slug } } },
    );
    if (error) throw error;
    listing = data;
  } catch (err) {
    const gone =
      err instanceof OperatorApiError &&
      (err.status === 404 || err.status === 400)
        ? err
        : null;
    return (
      <ClaimChrome>
        <Heading />
        {gone ? <NoListing message={gone.message} /> : <ReadFailed />}
        <StoreLine slug={slug} platform={platform} />
      </ClaimChrome>
    );
  }

  // OWNER or ADMIN may claim; MANAGER and STAFF are told who can.
  const roleLine = canManageAccess(me.roles)
    ? null
    : claimRoleLine(await readBusinessName(token));

  return (
    <ClaimChrome>
      <ClaimForm slug={slug} listing={listing} roleLine={roleLine} />
      <StoreLine slug={slug} platform={platform} />
    </ClaimChrome>
  );
}

function ClaimChrome({ children }: { children: ReactNode }) {
  return (
    <Screen nav="none" stageLabel="For operators" width="sm">
      {children}
    </Screen>
  );
}

function Heading() {
  return (
    <h1 className="font-display tracking-display leading-display text-4xl text-balance">
      {CLAIM_TITLE}
    </h1>
  );
}

function SignedOut({ slug }: { slug: string }) {
  const back = claimPath(slug);
  return (
    <>
      <Heading />
      <p
        className="text-forest/70 leading-body mt-3 text-base text-pretty"
        data-testid="claim-signed-out"
      >
        {CLAIM_SIGNED_OUT_LINE}
      </p>
      <div className="mt-8 flex flex-col gap-3">
        <ButtonLink href={signInPathFor(back, "/signup")}>
          Create an account
        </ButtonLink>
        <ButtonLink href={signInPathFor(back)} variant="secondary">
          Sign in
        </ButtonLink>
      </div>
    </>
  );
}

/** A removed or unknown listing: the API's sentence when it sent one, no retry. */
function NoListing({ message }: { message?: string }) {
  return (
    <Panel className="mt-6" data-testid="claim-no-listing">
      <p role="alert" className="text-base font-bold">
        {sentence(message ?? "") || NO_LISTING_LINE}
      </p>
    </Panel>
  );
}

function ReadFailed() {
  return (
    <div className="mt-6" data-testid="claim-read-failed">
      <Problem
        title="That did not load"
        body="We could not read this listing just now. Nothing was sent."
      />
      <ReadAgain />
    </div>
  );
}

/**
 * The stores, under the claim (#388: "a line under the web claim"), and Open
 * in the app when there is a listing to open. On an iPhone the Smart App
 * Banner takes that link's place, and on Android it is an `intent://` link
 * (`openInAppLink`).
 */
function StoreLine({
  slug,
  platform,
}: {
  slug: string | null;
  platform: HostAppPlatform;
}) {
  const open = openInAppLink(slug, platform);
  return (
    <section
      className="border-paper-line mt-10 border-t pt-6"
      data-testid="claim-store-line"
    >
      <p className="text-forest/70 leading-body text-sm text-pretty">
        {STORE_LINE}
      </p>
      <ul className="mt-4 flex flex-col gap-3 sm:flex-row">
        <li>
          <a
            href={HOST_APP_STORES.appStore}
            aria-label="Yuvoy Host on the App Store"
            className={buttonClass({ variant: "outline", block: true })}
          >
            App Store
          </a>
        </li>
        <li>
          <a
            href={HOST_APP_STORES.googlePlay}
            aria-label="Yuvoy Host on Google Play"
            className={buttonClass({ variant: "outline", block: true })}
          >
            Google Play
          </a>
        </li>
      </ul>
      {/*
        A plain link, not `next/link`: on this host a client-side navigation
        would stay inside this page and never reach the phone to hand on.
      */}
      {open ? (
        <a
          href={open}
          className="text-terra-deep tap-target mt-4 inline-flex text-sm font-bold underline underline-offset-4"
        >
          Open in the app
        </a>
      ) : null}
    </section>
  );
}
