/**
 * What the business receives from a fare — yuvoy-operator#44.
 *
 * The listing form has always wanted a "you receive ₹3,825" line beside the
 * price, and it could not have one: the rate was nowhere on a readable
 * response. Hardcoding 15% was the obvious shortcut and was refused, because a
 * business on its own negotiated rate would have been shown a number that was
 * simply wrong about its own money. `commissionRateBps` on `GET /me` closed it
 * (yuvoy-api#180).
 *
 * ## Basis points, and integer paise throughout
 *
 * 1500 bps is 15%. The arithmetic stays in integer paise and rounds ONCE, at
 * the end — a percentage taken in rupees and multiplied back is off by up to a
 * paisa per booking, and a figure that disagrees with the settlement by a
 * paisa is worse than no figure, because it invites a conversation about
 * whether we can count.
 *
 * `Math.round` rather than floor or ceil: the API's own rule is "taken on the
 * whole amount the traveller pays", and neither side should be systematically
 * favoured by the preview. This is a PREVIEW either way — the booking freezes
 * its own commission at capture — so it must never be presented as a promise.
 */

/** Basis points in a whole. */
const BPS = 10_000;

export interface CommissionPreview {
  /** What Yuvoy keeps, in paise. */
  feePaise: number;
  /** What reaches the business, in paise. */
  receivePaise: number;
}

/**
 * The split of one fare, or `null` when there is nothing honest to show.
 *
 * Null rather than a zero-commission split in three cases, and each of them is
 * a case where a number would be a claim we cannot back:
 *
 *   - **No rate.** "Absent where the service was not given a standard rate."
 *     A missing rate is not a rate of zero, and showing the whole fare as
 *     received would be the most flattering possible lie.
 *   - **No price.** A listing can be saved without one; there is nothing to
 *     split.
 *   - **A rate outside 0 to 100%.** Not reachable from the API, and a
 *     negative or >100% rate would render a business receiving more than the
 *     traveller paid, or less than nothing.
 */
export function commissionPreview(
  unitPricePaise: number | null | undefined,
  rateBps: number | null | undefined,
): CommissionPreview | null {
  if (
    typeof unitPricePaise !== "number" ||
    !Number.isFinite(unitPricePaise) ||
    unitPricePaise <= 0
  ) {
    return null;
  }
  if (
    typeof rateBps !== "number" ||
    !Number.isInteger(rateBps) ||
    rateBps < 0 ||
    rateBps > BPS
  ) {
    return null;
  }

  const feePaise = Math.round((unitPricePaise * rateBps) / BPS);
  return { feePaise, receivePaise: unitPricePaise - feePaise };
}

/** "15%" from 1500. One decimal only where the rate has one. */
export function formatRate(rateBps: number): string {
  const percent = rateBps / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0$/, "")}%`;
}
