/**
 * The navigation registry — the single source of truth for every destination
 * in the portal. The floating tab bar and the desktop rail both derive from
 * it, and a route is added here in the same change that ships its page.
 *
 * Four destinations. The day is what an operator opens at 6am; requests have
 * a clock on them; capacity is "the single most important number in the
 * system"; and everything about the business itself — money, people, footage,
 * whether the account can trade — sits behind one door.
 */

export type NavIcon = "today" | "requests" | "capacity" | "business";

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
    href: "/account",
    label: "Business",
    icon: "business",
    match: (p) =>
      p.startsWith("/account") ||
      p.startsWith("/earnings") ||
      p.startsWith("/payouts") ||
      p.startsWith("/team") ||
      p.startsWith("/reels"),
  },
] as const;

/**
 * FOCUSED routes: screens an operator goes INTO rather than between.
 *
 * On a phone these hide the floating bar and carry a back control. The
 * manifest sits under Today; the money, people and footage screens sit under
 * Business, and each goes back to the door it came through.
 */
export const FOCUSED_ROUTE_PREFIXES = [
  "/today/",
  "/earnings",
  "/payouts",
  "/team",
  "/reels",
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
