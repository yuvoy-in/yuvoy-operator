/**
 * The navigation registry — the single source of truth for every destination
 * in the portal. The floating tab bar and the desktop rail both derive from
 * it, and a route is added here in the same change that ships its page.
 *
 * Five destinations. The day is what an operator opens at 6am; **bookings**
 * is who is coming; **calendar** is where the seats are promised, "the single
 * most important number in the system"; **listings** is what the business
 * actually sells and the footage that sells it; and everything else about the
 * business — money, people, whether the account can trade — sits behind one
 * door.
 *
 * ## Why Services became Listings (yuvoy-operator#42)
 *
 * Owner ruling, 11 September 2026, on the product demo's five tabs: keep
 * Today and the Business door, rename Services to Listings, add the two
 * badges. The tab said "Services" while the screen under it said "Listings",
 * which is the one-word-per-thing rule (D-031 C10) broken in the most visible
 * place there is. The URLs stay under `/services`: they are in operators'
 * histories, and a path is not something anybody reads.
 *
 * Earnings stays a door inside Business until the API behind the demo's
 * Earnings tab exists (yuvoy-operator#47).
 *
 * ## Why Requests became Bookings (yuvoy-operator#32, #34)
 *
 * Requests only ever held request-mode bookings awaiting an answer. Migration
 * 0054 changed the default booking mode from `request` to `allotment` (D-031
 * P5), because the product thesis is paid and confirmed inside sixty seconds
 * — so an operator on the new default has an EMPTY Requests tab, while the
 * confirmed bookings they actually need to see had no home at all. The
 * requests queue is still the first thing on the tab and still ordered by how
 * soon each expires; it is a section now rather than a destination.
 *
 * ## Why Capacity became Calendar (yuvoy-operator#32, #36)
 *
 * A calendar is what an operator thinks they are looking at. "Capacity" is
 * our word for it, and D-031 C10 settles one word per thing: **listing** where
 * an operator edits, **experience** where a traveller reads, **departure** for
 * a dated occurrence.
 *
 * ## Why listings is a stop rather than another thing behind Business
 *
 * Owner ruling, 6 September 2026 (yuvoy-operator#22). Reels lived under the
 * Business door and Activities did not exist at all, which meant an operator
 * could sign in, read what was outstanding on their account, and then do
 * nothing about the two things the business IS.
 */

export type NavIcon =
  "today" | "bookings" | "calendar" | "listings" | "business";

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
    href: "/bookings",
    label: "Bookings",
    icon: "bookings",
    // `/requests` still matches so the redirect that stands there lights the
    // right stop for the moment it is on screen, and so an old bookmark does
    // not flash an unlit bar on its way through.
    match: (p) => p.startsWith("/bookings") || p.startsWith("/requests"),
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: "calendar",
    match: (p) => p.startsWith("/calendar") || p.startsWith("/capacity"),
  },
  {
    href: "/services/activities",
    label: "Listings",
    icon: "listings",
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
      p.startsWith("/cash") ||
      p.startsWith("/payouts") ||
      p.startsWith("/profile") ||
      p.startsWith("/logo") ||
      p.startsWith("/story") ||
      p.startsWith("/team"),
  },
] as const;

/**
 * The two counts on the bar — yuvoy-operator#42.
 *
 * "Bookings shows the count of pending requests. Account shows the count of
 * missing required verification documents. These badges turn unfinished
 * obligations into visible work queues."
 *
 * Each count is the number of rows under the matching heading on the screen
 * the stop opens — "Waiting on you" on both — and never a figure worked out
 * separately. A badge that says 3 over a screen listing 2 is the fastest way
 * to teach somebody to ignore it.
 *
 * **Absent means unknown, never zero.** A read that failed renders no badge,
 * which is the same thing a genuinely empty queue renders — the one wrong
 * answer is a number nobody measured.
 */
export interface NavBadges {
  /** Seat requests waiting on an answer: the queue on Bookings. */
  bookings?: number;
  /** Items on the account waiting on the operator: the list on Business. */
  business?: number;
}

/** Which stop carries which count, and what the count is OF, said out loud. */
export const BADGES: Partial<
  Record<NavIcon, { key: keyof NavBadges; spoken: string }>
> = {
  bookings: { key: "bookings", spoken: "waiting on your answer" },
  business: { key: "business", spoken: "waiting on you" },
};

/** A count as the bubble draws it. Past nine the exact number is not the point. */
export function badgeText(count: number): string {
  return count > 9 ? "9+" : String(count);
}

/**
 * FOCUSED routes: screens an operator goes INTO rather than between.
 *
 * On a phone these hide the floating bar and carry a back control. The
 * manifest sits under Today; the money and people screens sit under Business,
 * and each goes back to the door it came through.
 *
 * **Listings is NOT focused**, and that is the difference between a stop and a
 * screen you go into. Listings and Reels are two halves of one job — "this
 * listing has no video" and "this clip is attached to nothing" are the same
 * question asked from both ends — so an operator moves between them
 * constantly, and a back disc that leaves the section would be in the way
 * every time.
 */
export const FOCUSED_ROUTE_PREFIXES = [
  "/today/",
  // One booking, opened from the list and closed back to it. The list itself
  // is a tab root; `/bookings/` with the slash is a booking.
  "/bookings/",
  "/earnings",
  "/cash",
  "/payouts",
  "/profile",
  // The logo, which is mandatory before an operator can be booked and is
  // reached from the blocker that says so (yuvoy-operator#33, #35 §2).
  "/logo",
  // What travellers read about the business, reached from the Business door
  // beside the logo (yuvoy-operator#41).
  "/story",
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
