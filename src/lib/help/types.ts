/**
 * The portal's help: every explanation that used to sit beside a control,
 * gathered in one place behind the gear (yuvoy-operator#80 t4).
 *
 * "Cut every sentence that explains what the screen is. Keep only the
 * sentence that changes a decision, for example 'Closing stops new bookings.
 * Bookings already made stay.' Move the rest into a single help entry under
 * the gear." A screen carries its controls and the one sentence that changes
 * what somebody does next; the reasons live here, where anybody who wants
 * them reads them once instead of scrolling past them every morning.
 */

/** Where the question comes up. The help page groups by it, in this order. */
export const HELP_AREAS = [
  "Today",
  "Bookings",
  "Calendar",
  "Listings",
  "Money",
  "Business",
  "Team",
] as const;

export type HelpArea = (typeof HELP_AREAS)[number];

export interface HelpTopic {
  /**
   * The anchor on the help page, so a screen can link straight to its answer:
   * lowercase words joined by hyphens, unique across every area.
   */
  id: string;
  area: HelpArea;
  /** Asked the way an operator would ask it: "Why is a departure not on sale?" */
  question: string;
  /** One entry per paragraph, in plain sentences. The page adds nothing. */
  answer: readonly string[];
}

export const HELP_PATH = "/account/help";

/**
 * A link to one answer on the help page, carrying the screen it was opened
 * from so the help page's back control returns there (`helpBack`).
 *
 * `from` is a path in this portal, as `usePathname` gives it or as a page
 * names itself. A plain link either way: the back control never reads the
 * browser's history, which is not ours on a phone handed over mid-morning.
 */
export function helpHref(id: string, from?: string): string {
  const query = from ? `?from=${encodeURIComponent(from)}` : "";
  return `${HELP_PATH}${query}#${id}`;
}

/** Where help's back control goes when it was not told, or told nonsense. */
const SETTINGS_BACK = { href: "/account/settings", label: "settings" };

/**
 * The screens a help link may send back to, and what "Back to ..." calls
 * each. First match wins, so a screen gone into sits above its tab root.
 */
const BACK_TO: readonly (readonly [RegExp, string])[] = [
  [/^\/today$/, "today"],
  [/^\/today\/listing\/[\w-]+$/, "the listing"],
  [/^\/today\/[\w-]+$/, "the departure"],
  [/^\/bookings$/, "bookings"],
  [/^\/bookings\/[\w-]+$/, "the booking"],
  [/^\/calendar$/, "calendar"],
  [/^\/earnings$/, "money"],
  [/^\/cash$/, "cash"],
  [/^\/payouts$/, "payout details"],
  [/^\/logo$/, "your logo"],
  [/^\/team$/, "your team"],
  [/^\/account$/, "your business"],
  [/^\/account\/settings$/, "settings"],
  [/^\/account\/listings\/[\w-]+$/, "the listing"],
  [/^\/account\/listings\/[\w-]+\/edit$/, "editing the listing"],
];

/**
 * Where help's back control goes (the audit before release, M12).
 *
 * It always went to Settings, so somebody who tapped "What pausing does" on a
 * listing was sent somewhere they had never been. Now it is the screen the
 * link named, when that is a screen of this portal; anything else, a direct
 * load included, falls back to Settings, where Help lives. Matched against a
 * list rather than trusted, so a crafted link cannot make "back" leave the
 * portal or land somewhere unnamed.
 */
export function helpBack(from: unknown): { href: string; label: string } {
  if (typeof from !== "string") return SETTINGS_BACK;
  const hit = BACK_TO.find(([pattern]) => pattern.test(from));
  return hit ? { href: from, label: hit[1] } : SETTINGS_BACK;
}
