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
export const HOST_APP_STORES = {
  appStore: "https://apps.apple.com/app/id6820854539",
  googlePlay: "https://play.google.com/store/apps/details?id=in.yuvoy.operator",
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
