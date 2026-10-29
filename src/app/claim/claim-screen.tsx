import { Screen } from "@/components/chrome/screen";
import { buttonClass } from "@/components/ui/button-class";
import { HOST_APP_STORES, claimLink } from "@/lib/site/host-app";

/**
 * What `operators.yuvoy.in/claim/{slug}` shows on a phone or a computer
 * without Yuvoy Host (yuvoy-operator#171). With the app, the phone hands the
 * link to it and this never draws.
 *
 * The traveller app's "Claim in Yuvoy Host" on a business that is not on
 * Yuvoy yet opens that link. Claiming happens in the app, so all this says
 * is how to get there: the two stores, then the link again.
 *
 * No API call, and the listing is never named: an unknown slug draws the
 * same page, and the app says "There is no listing to claim here." if it is
 * gone. With no slug at all there is nothing to open, so no Open in the app.
 *
 * A signed-out door (`BARE_ROUTE_PREFIXES`): the person reading it may have
 * no account yet, and a session on this browser changes nothing here.
 *
 * Replaced by the web claim page and the claims list with the web backfill
 * at the store release that carries the app's claim.
 */
export function ClaimScreen({ slug }: { slug: string | null }) {
  const open = claimLink(slug);

  return (
    <Screen nav="none" stageLabel="For operators" width="sm">
      <h1 className="font-display tracking-display leading-display text-4xl text-balance">
        Claim this listing in Yuvoy Host
      </h1>
      <p className="text-forest/70 leading-body mt-3 text-base text-pretty">
        Claiming happens in our app for businesses. Get Yuvoy Host, sign up or
        sign in as your business, then open this link again.
      </p>

      <ul className="mt-8 flex flex-col gap-3 sm:flex-row">
        <li>
          <a
            href={HOST_APP_STORES.appStore}
            aria-label="Yuvoy Host on the App Store"
            className={buttonClass({ variant: "secondary", block: true })}
          >
            App Store
          </a>
        </li>
        <li>
          <a
            href={HOST_APP_STORES.googlePlay}
            aria-label="Yuvoy Host on Google Play"
            className={buttonClass({ variant: "secondary", block: true })}
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
        <a href={open} className={buttonClass({ block: true, className: "mt-6" })}>
          Open in the app
        </a>
      ) : null}
    </Screen>
  );
}
