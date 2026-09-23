import type { OperatorSlot } from "./types";

/**
 * Departures that are not on sale when they should be, and what the calendar
 * calls each departure's state (yuvoy-operator#84 s7).
 *
 * ## The mark on a day is lost money, not every "no"
 *
 * "Sky diving at key west" is a live listing whose departures were not being
 * sold, and the only clue was a sentence in the middle of a card nobody
 * scrolled to. The calendar now marks the DAY, so the fortnight says at a
 * glance where sales are being lost.
 *
 * Not every departure that cannot be bought is lost money, and marking all of
 * them would teach an operator to ignore the mark:
 *
 *   - one the operator stopped selling, or called off, is a decision already
 *     made;
 *   - one past its booking cutoff, or full, is the day working as it should;
 *   - one on a draft, a listing in review, a paused or unpriced listing is
 *     not on sale because the LISTING is not, which the listing's own screen
 *     says.
 *
 * Everything else is marked: seats nobody confirmed, a lapsed or missing
 * document, a business that is not selling, an emergency stop, and any reason
 * this build has never met. The contract's own rule for an unknown reason is
 * to say it, and an unexplained departure off sale is exactly the case the
 * mark exists for.
 */

/** Reasons that are not lost money: decided, working, or about the listing. */
const NOT_A_LOSS = new Set([
  "departure_closed",
  "departure_called_off",
  "departure_past_cutoff",
  "departure_full",
  "listing_draft",
  "listing_in_review",
  "listing_withdrawn",
  "listing_unpriced",
]);

/** The reason a hand-set seat count stops selling after two quiet days. */
export const SEATS_UNCONFIRMED = "departure_seats_unconfirmed";

/**
 * Whether this departure is off sale in a way the operator would want to
 * know about today.
 *
 * `onSale` absent is an older API and reads as on sale: absent must never
 * paint a fortnight of alarms. A called-off or closed departure is read from
 * its status as well as its reason, so a response that disagrees with itself
 * still never marks a decision the operator already made.
 */
export function lostSale(slot: OperatorSlot): boolean {
  if (slot.onSale !== false) return false;
  if (slot.status === "cancelled" || slot.status === "closed") return false;
  return !NOT_A_LOSS.has(slot.notOnSaleReason ?? "");
}

/** How many of a day's departures are lost sales. */
export function lostSalesOn(departures: readonly OperatorSlot[]): number {
  return departures.filter(lostSale).length;
}

/** Whether this departure is off sale only because nobody confirmed its seats. */
export function seatsUnconfirmed(slot: OperatorSlot): boolean {
  return (
    slot.onSale === false &&
    slot.status === "open" &&
    slot.notOnSaleReason === SEATS_UNCONFIRMED
  );
}

/**
 * The chip on a departure's row, or `null` for one that is simply selling.
 *
 * `loud` is the accent: only a lost sale earns it. "Called off", "Closed" and
 * "Full" are facts; "Not on sale" beside a draft is the listing's business.
 */
export function saleChip(
  slot: OperatorSlot,
): { label: string; loud: boolean } | null {
  if (slot.status === "cancelled") return { label: "Called off", loud: false };
  if (slot.status === "closed") return { label: "Closed", loud: false };
  if (slot.onSale !== false) return null;
  if (slot.notOnSaleReason === "departure_full") {
    return { label: "Full", loud: false };
  }
  return { label: "Not on sale", loud: lostSale(slot) };
}

/** "2 not on sale", the day's mark. */
export function lostSalesLabel(count: number): string {
  return `${count} not on sale`;
}
