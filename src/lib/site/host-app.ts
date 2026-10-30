/**
 * Yuvoy Host, the operator app, as a phone without it is sent to it
 * (yuvoy-operator#171).
 *
 * ## The store listings
 *
 * The same two as STORE_URLS in the app's own apps/operator/app.config.ts
 * (yuvoy-mobile#406): App Store id 6820854539, Play package
 * `in.yuvoy.operator`, the package `assetlinks.json` names. Neither opens a
 * listing until the app is approved in that store, which is why the page
 * that links them is held on `dev` with the app's first store build.
 */
const APP_STORE_ID = "6820854539";
const PLAY_PACKAGE = "in.yuvoy.operator";

export const HOST_APP_STORES = {
  appStore: `https://apps.apple.com/app/id${APP_STORE_ID}`,
  googlePlay: `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`,
} as const;

/**
 * The address the app is handed a claim by: production's, always, never
 * this deployment's own. It is the link iOS and Android give to Yuvoy Host
 * once `/claim/*` is in this host's link files, and a preview's address is
 * one no phone hands to any app.
 */
const CLAIM_LINK_ORIGIN = "https://operators.yuvoy.in";

/**
 * The claim link for one listing, or null with no slug: an app opened onto
 * a claim of nothing has nothing to show.
 */
export function claimLink(slug: string | null | undefined): string | null {
  const trimmed = slug?.trim();
  if (!trimmed) return null;
  return `${CLAIM_LINK_ORIGIN}/claim/${encodeURIComponent(trimmed)}`;
}

/**
 * Which phone is reading the claim page, from its User-Agent. iPadOS Safari
 * says it is a Mac, so an iPad is `other`: it still gets the Smart App
 * Banner, and the plain link beside it.
 */
export type HostAppPlatform = "ios" | "android" | "other";

export function hostAppPlatform(
  userAgent: string | null | undefined,
): HostAppPlatform {
  const ua = userAgent ?? "";
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  return "other";
}

/**
 * Where "Open in the app" goes, or null for no button.
 *
 * A link tapped on a page of the same host stays in the browser: iOS never
 * opens a universal link from its own domain, and Android Chrome often keeps
 * one too (manager decision, 29 Oct 13:07). So:
 *
 * - iOS: no button. The Smart App Banner (`claimBanner`) replaces it and
 *   hands the app the claim link.
 * - Android: an `intent://` link to Yuvoy Host by package, which Chrome hands
 *   to the app, or sends to the Play listing when the app is missing or
 *   cannot open a claim yet.
 * - Anything else: the claim link itself, as before.
 */
export function openInAppLink(
  slug: string | null | undefined,
  platform: HostAppPlatform,
): string | null {
  const link = claimLink(slug);
  if (!link || platform === "ios") return null;
  if (platform === "other") return link;
  const { host, pathname } = new URL(link);
  const fallback = encodeURIComponent(HOST_APP_STORES.googlePlay);
  return `intent://${host}${pathname}#Intent;scheme=https;package=${PLAY_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

/**
 * The Smart App Banner for Next's `metadata.itunes`: Safari on iOS draws
 * Yuvoy Host's App Store bar, whose Open hands the app the claim link. With
 * no slug the banner still offers the app, with nothing to open.
 */
export function claimBanner(slug: string | null | undefined): {
  appId: string;
  appArgument?: string;
} {
  const link = claimLink(slug);
  return link
    ? { appId: APP_STORE_ID, appArgument: link }
    : { appId: APP_STORE_ID };
}
