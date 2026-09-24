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

/** A link to one answer on the help page. */
export function helpHref(id: string): string {
  return `${HELP_PATH}#${id}`;
}
