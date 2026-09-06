/**
 * The navigation registry — the single source of truth for every destination
 * in the portal. The floating tab bar and the desktop rail both derive from
 * it, and a route is added here in the same change that ships its page.
 *
 * Five destinations. The day is what an operator opens at 6am; requests have
 * a clock on them; capacity is "the single most important number in the
 * system"; **services** is what the business actually consists of — what they
 * sell and the footage that sells it; and everything else about the business —
 * money, people, whether the account can trade — sits behind one door.
 *
 * ## Why services is a stop rather than another thing behind Business
 *
 * Owner ruling, 6 September 2026 (yuvoy-operator#22). Reels lived under the
 * Business door and Activities did not exist at all, which meant an operator
 * could sign in, read what was outstanding on their account, and then do
 * nothing about the two things the business IS.
 *
 * Business is the back office — money, people, standing. The catalogue is not
 * back office: adding a listing and putting a clip on it is the work, and
 * burying it two taps behind a door named for the paperwork is what made it
 * unreachable. So the bar went from four stops to five.
 */

export type NavIcon =
  "today" | "requests" | "capacity" | "services" | "business";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Matched as a prefix so `/today/<slot>` still highlights Today. */
  match: (pathname: string) => boolean;
}

export const NAV: readonly NavItem[] = [
  {
    href: "/today",
    label: "Today",
    icon: "today",
    match: (p) => p === "/today" || p.startsWith("/today/"),
  },
  {
    href: "/requests",
    label: "Requests",
    icon: "requests",
    match: (p) => p.startsWith("/requests"),
  },
  {
    href: "/capacity",
    label: "Capacity",
    icon: "capacity",
    match: (p) => p.startsWith("/capacity"),
  },
  {
    href: "/services/activities",
    label: "Services",
    icon: "services",
    /*
      The section, not the page. `/services` has two pages under it and the
      stop points at the first — an operator opening this tab is far more often
      adding or fixing a listing than looking at footage, and a hub in between
      would be a tap that shows them nothing.
    */
    match: (p) => p.startsWith("/services"),
  },
  {
    href: "/account",
    label: "Business",
    icon: "business",
    match: (p) =>
      p.startsWith("/account") ||
      p.startsWith("/earnings") ||
      p.startsWith("/payouts") ||
      p.startsWith("/team"),
  },
] as const;

/**
 * FOCUSED routes: screens an operator goes INTO rather than between.
 *
 * On a phone these hide the floating bar and carry a back control. The
 * manifest sits under Today; the money and people screens sit under Business,
 * and each goes back to the door it came through.
 *
 * **Services is NOT focused**, and that is the difference between a stop and a
 * screen you go into. Activities and Reels are two halves of one job — "this
 * activity has no video" and "this clip is attached to nothing" are the same
 * question asked from both ends — so an operator moves between them
 * constantly, and a back disc that leaves the section would be in the way
 * every time.
 */
export const FOCUSED_ROUTE_PREFIXES = [
  "/today/",
  "/earnings",
  "/payouts",
  "/team",
] as const;

/**
 * BARE routes: no session, so no chrome at all. The three doors — signing up,
 * signing in, and accepting an invitation — draw the mark and nothing else.
 *
 * `/signup` does not collide with `/sign-in` under `startsWith`: neither is a
 * prefix of the other. A test pins that, because a hyphen is a thin thing to
 * rest a route match on.
 */
export const BARE_ROUTE_PREFIXES = ["/sign-in", "/signup", "/join"] as const;

export function isFocusedRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return FOCUSED_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function isBareRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return BARE_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
