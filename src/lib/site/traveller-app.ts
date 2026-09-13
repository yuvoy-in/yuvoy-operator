/**
 * Where a business's page lives for a traveller — yuvoy-operator#41.
 *
 * ## Why this is one function and not a literal in the story screen
 *
 * The address is about to move. The app launched on `app.yuvoy.in` (owner, 3
 * Sep) and the D-102 cutover onto `yuvoy.in` is deferred, not cancelled —
 * yuvoy-app#12 is open and the redirects for it are already built and sitting
 * inert. When it happens, this is the one line that changes rather than a
 * string in whatever screens have grown a link by then.
 *
 * ## Why it is an environment variable with a default, not a hardcoded host
 *
 * A preview deployment of this portal should be able to point at a preview of
 * the app. But the default is the production host rather than an empty string:
 * a missing variable must not produce `/o/hc-diving-skl`, which on this origin
 * is a 404 inside the portal rather than a business's page.
 *
 * `NEXT_PUBLIC_` because a link is rendered in the browser. That prefix has
 * bitten this project before — a `NEXT_PUBLIC_` value marked Sensitive in
 * Vercel reaches the build as `[SENSITIVE]` and cost yuvoy-app three deploys
 * — so this one must NOT be marked Sensitive. It is a public hostname; there
 * is nothing in it to hide.
 */
const DEFAULT_ORIGIN = "https://app.yuvoy.in";

export function travellerAppOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_TRAVELLER_APP_URL?.trim();
  if (!configured) return DEFAULT_ORIGIN;

  /*
    A value that is not a URL is worse than no value: it would render a link
    that goes nowhere, on a button that promises a preview. Fall back rather
    than throw — a malformed variable must not take the story screen down.
  */
  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

/**
 * The business's public page.
 *
 * `slug` is required on `GET /me` and always present (`operators.slug` is
 * `not null unique`), but this takes a nullable one anyway and answers `null`:
 * required in a contract is a promise about master, not about the deployed
 * API, and a preview button whose href is `/o/undefined` is worse than no
 * button.
 */
export function operatorPageUrl(
  slug: string | null | undefined,
): string | null {
  const trimmed = slug?.trim();
  if (!trimmed) return null;
  return `${travellerAppOrigin()}/o/${encodeURIComponent(trimmed)}`;
}
