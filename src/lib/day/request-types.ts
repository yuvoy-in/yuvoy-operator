import type { components } from "@/lib/api/schema.gen";

/**
 * Requests, and the pure things a screen needs to say about one.
 *
 * Separate from `requests.ts` for the same reason the manifest's types are:
 * that module is `server-only` because it holds a session, and a client
 * component needing this type must not import it.
 */

export type OpenRequest = components["schemas"]["OpenRequest"];

/**
 * How urgent a request is.
 *
 * `minutesToAnswer` is computed server-side and never negative, so every
 * client agrees. The bands are ours — the number alone does not tell an
 * operator scanning a list at 6am which row to touch first.
 */
export type Urgency = "critical" | "soon" | "later";

export function urgencyOf(minutes: number | undefined): Urgency {
  const m = minutes ?? 0;
  // Under an hour is somebody who will be told no by a clock if this screen is
  // closed now.
  if (m <= 60) return "critical";
  if (m <= 240) return "soon";
  return "later";
}

/**
 * The clock, in words.
 *
 * Rendered from the server's `minutesToAnswer` and never re-derived from
 * `expiresAt` on the client. Two clients computing "37 minutes left" from a
 * timestamp will disagree by however far apart their clocks are, and this is
 * a number an operator makes a decision on.
 */
export function timeToAnswer(minutes: number | undefined): string {
  const m = minutes ?? 0;
  if (m <= 0) return "Out of time";
  if (m < 60) return `${m} min left`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m left` : `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

/**
 * Whether accepting this request is even possible.
 *
 * `seatsGrantable` is "seats still grantable before physical capacity is
 * reached", and the contract puts it beside the request because "accept with
 * no sense of what is left is a decision made blind". Accepting anyway answers
 * `409 grant_ceiling_exceeded`, so the button is disabled rather than offered
 * and refused.
 */
export function canGrant(request: OpenRequest): boolean {
  return (request.seatsGrantable ?? 0) >= (request.guests ?? 0);
}

/** Why a request was turned down. A closed set, in the contract's order. */
export const DECLINE_REASONS = [
  { code: "no_capacity", label: "No seats left" },
  { code: "weather", label: "Weather" },
  { code: "not_operating", label: "Not running that day" },
  { code: "party_too_large", label: "Party too large" },
  { code: "unsafe_for_party", label: "Not safe for this party" },
  { code: "other", label: "Something else" },
] as const;

export type DeclineReason = (typeof DECLINE_REASONS)[number]["code"];
