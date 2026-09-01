/**
 * Capacity — the single most important number in the system.
 *
 * Three writes live here, and each has a rule that is not a preference:
 *
 *   · a departure cannot be reduced below what is already sold
 *   · closing dates is not cancelling people
 *   · an offline sale that oversells must never look like a success
 */

/** Why a date range is closed. A closed set, upper case, as the contract has it. */
export const BLACKOUT_REASONS = [
  { code: "WEATHER", label: "Weather" },
  { code: "MAINTENANCE", label: "Maintenance" },
  { code: "STAFF", label: "Staff" },
  { code: "PERSONAL", label: "Personal" },
  { code: "SEASONAL", label: "Out of season" },
  { code: "OTHER", label: "Something else" },
] as const;

export type BlackoutReason = (typeof BLACKOUT_REASONS)[number]["code"];

/** The contract's own bounds on a seat count. */
export const MAX_SEATS = 200;

/**
 * Whether a proposed capacity is one the API will accept.
 *
 * The floor is what is already **sold**, not zero. "Reducing to exactly what
 * is sold is allowed: that closes the departure without stranding anyone."
 * Below that the database refuses, "because the alternative is a traveller
 * with a paid booking and no seat, discovered at a jetty at six in the
 * morning" — so the UI refuses first, with the same reason, rather than
 * spending a round trip to be told.
 */
export function capacityProblem(seats: number, sold: number): string | null {
  if (!Number.isInteger(seats)) return "Seats must be a whole number.";
  if (seats < 0) return "Seats cannot be negative.";
  if (seats > MAX_SEATS)
    return `The most a departure can offer is ${MAX_SEATS}.`;
  if (seats < sold) {
    return `${sold} ${sold === 1 ? "seat is" : "seats are"} already sold. You cannot go below that — it would strand somebody who has paid. Setting it to exactly ${sold} closes the departure without stranding anyone.`;
  }
  return null;
}

/** `YYYY-MM-DD`, and `to` cannot precede `from`. */
export function blackoutProblem(from: string, to: string): string | null {
  const shape = /^\d{4}-\d{2}-\d{2}$/;
  if (!shape.test(from) || !shape.test(to)) {
    return "Pick both dates.";
  }
  if (to < from) return "The last day cannot be before the first.";
  return null;
}
