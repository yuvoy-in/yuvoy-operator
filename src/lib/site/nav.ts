/**
 * The navigation registry: the single source of truth for every destination
 * in the portal. The floating tab bar and the desktop rail both derive from
 * it, and a route is added here in the same change that ships its page.
 *
 * FIVE destinations since yuvoy-operator#96, each named for the one job an
 * operator opens it for:
 *
 *   Today     run today and miss nothing: whether the business is selling,
 *             what needs an answer, what is running, the money in a line.
 *             The owner's #96 table names the stop "Today"; the screen is
 *             still Home in code (`lib/home`, `app/today/(root)`).
 *   Bookings  the customers: requests first, then who is coming
 *   Calendar  what can sell and when: departures, seats, closures
 *   Money     earned and owed: the next payout, cash held and owed, statements
 *   Business  the shop window: the profile, its listings and reels, and the
 *             settings behind the gear
 *
 * Messages is not a stop. It is the inbox control at the right edge of every
 * signed-in screen's stage, because a guest writes whatever screen the
 * operator happens to be on.
 *
 * ## Why Money became a tab (yuvoy-operator#96)
 *
 * It was three taps away: Business, then Settings, then Earnings, filed beside
 * the logo and the notification switches. For an operator it is the second
 * reason to open the portal at all, after the day itself. The three money
 * screens (`/earnings`, `/cash`, `/payouts`) light this stop and no longer
 * light Business.
 *
 * It is drawn only for a login that can manage (`audience: "manage"`). Every
 * money read refuses STAFF, so for them the stop would open onto a refusal:
 * a staff phone sees four stops, and the order of the four does not move.
 *
 * ## Why every stop carries its label (yuvoy-operator#80 t6)
 *
 * The bar used to name only the stop you were already on. A ticket and a
 * briefcase are not words anybody guesses as Bookings and Business, and the
 * one label shown was the one place nobody needed it. All five are labelled,
 * always, on the bar and on the rail.
 *
 * ## Why Listings left Home (yuvoy-operator#96)
 *
 * Home was half run sheet and half catalogue, and the catalogue grows with the
 * business and pushes the day down. Every listing is on Business, where they
 * are made and mended, and Home keeps a one-line count that opens it.
 *
 * ## The older renames, kept for the reasons they give
 *
 * Requests became Bookings (yuvoy-operator#32, #34): an operator on the
 * default booking mode had an empty Requests tab while the confirmed bookings
 * they needed had no home. Capacity became Calendar for the same reason: a
 * calendar is what an operator thinks they are looking at, and D-031 C10
 * settles one word per thing. Both old URLs still resolve and still light the
 * right stop for the moment their redirect is on screen.
 */

export type NavIcon = "home" | "bookings" | "calendar" | "money" | "business";

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Matched as a prefix so `/today/<slot>` still highlights Home. */
  match: (pathname: string) => boolean;
  /**
   * Who is shown this stop. Absent means every role.
   *
   * `manage` is OWNER, ADMIN or MANAGER, `me.canManage` exactly as `GET /me`
   * defines it. A stop is not drawn for somebody the screen behind it refuses:
   * a destination that opens onto "you cannot see this" is a stop somebody
   * learns to avoid, and it pushes the others apart for nothing.
   */
  audience?: "manage";
}

/**
 * `root` itself or anything under it, and nothing that merely starts with the
 * same letters: `/earnings` and `/earnings/stl_1`, never `/earningsx`.
 */
function under(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export const NAV: readonly NavItem[] = [
  {
    href: "/today",
    /*
      "Today", the owner's name for it in yuvoy-operator#96's table: it is the
      day that is run from here. The screen is still called Home in code.
    */
    label: "Today",
    icon: "home",
    /*
      The path stays `/today`. It is in operators' histories and a path is not
      something anybody reads. `/today/listing/{id}` is under it, so the
      listing hub lights Today and draws as a focused screen.
    */
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
    href: "/earnings",
    label: "Money",
    icon: "money",
    audience: "manage",
    /*
      The three money screens. `/earnings` is the tab root; a settlement
      (`/earnings/{id}`), what is owed on cash, and the payout details are
      screens gone INTO from it, and still light it.
    */
    match: (p) =>
      under(p, "/earnings") || under(p, "/cash") || under(p, "/payouts"),
  },
  {
    href: "/account",
    label: "Business",
    icon: "business",
    match: (p) =>
      p.startsWith("/account") ||
      /*
        `/services` still lights Business, for the instant its redirect is on
        screen: both halves of the old Listings tab now resolve to the business
        profile, and an old bookmark must not flash an unlit bar on its way
        through.
      */
      p.startsWith("/services") ||
      p.startsWith("/profile") ||
      p.startsWith("/logo") ||
      p.startsWith("/story") ||
      p.startsWith("/team"),
  },
] as const;

/**
 * The stops this login is shown, in the registry's order.
 *
 * Filtered rather than reordered: the stops a staff phone keeps sit in the
 * same order as everybody else's, because the bar is muscle memory and a stop
 * that moves is a mis-tap.
 */
export function navFor(access: { canManage: boolean }): readonly NavItem[] {
  return NAV.filter(
    (item) => item.audience !== "manage" || access.canManage === true,
  );
}

/**
 * The two counts on the bar, yuvoy-operator#42.
 *
 * "Bookings shows the count of pending requests. Account shows the count of
 * missing required verification documents. These badges turn unfinished
 * obligations into visible work queues."
 *
 * Each count is the number of rows under the matching heading on the screen
 * the stop opens, "Waiting on you" on both, and never a figure worked out
 * separately. A badge that says 3 over a screen listing 2 is the fastest way
 * to teach somebody to ignore it.
 *
 * **Absent means unknown, never zero.** A read that failed renders no badge,
 * which is the same thing a genuinely empty queue renders: the one wrong
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
 * manifest and the listing hub sit under Home; a settlement, the cash screen
 * and the payout details sit under Money; the people and profile screens sit
 * under Business; and each goes back to the door it came through.
 *
 * **`/earnings` itself is NOT focused**, and the slash is the whole
 * difference: it is the Money tab root (yuvoy-operator#96), so it carries the
 * bar, while `/earnings/{id}` is one settlement and carries a way back.
 * `nav.test.ts` pins both halves, because a prefix one slash short would take
 * the bar off a tab root.
 */
export const FOCUSED_ROUTE_PREFIXES = [
  "/today/",
  // One booking, opened from the list and closed back to it. The list itself
  // is a tab root; `/bookings/` with the slash is a booking.
  "/bookings/",
  // One settlement. `/earnings` without the slash is the Money tab root.
  "/earnings/",
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
  /*
    Conversations with travellers, and the two notification screens.

    All three are gone INTO: the inbox rides the stage on every screen, and
    notifications open from Settings or from a member on the team. None of
    them was listed here, so each drew a back control AND the floating bar,
    over a sheet with no room left for it.
  */
  "/messages",
  "/notifications",
  /*
    Everything UNDER Business, with the slash, yuvoy-operator#58. `/account`
    itself is the tab root: the business profile, which is where an operator
    lands. Settings, verification and the listing screens are places they go
    INTO from it and close back out of.
  */
  "/account/",
] as const;

/**
 * BARE routes: no session, so no chrome at all. The three doors (signing up,
 * signing in, and accepting an invitation) draw the mark and nothing else.
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
