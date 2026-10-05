import {
  dayCaption,
  deadlineLabel,
  marketTime,
} from "@/lib/format/market-time";
import { marketDayOf } from "./calendar";
import { requestAge } from "./request-time";
import {
  canGrant,
  timeToAnswer,
  urgencyOf,
  type DeclineReason,
  type OpenRequest,
} from "./request-types";

/**
 * One seat request as its card says it, on Home and on Bookings alike.
 *
 * Home's answer used to be the weakest copy of the portal's most urgent act:
 * the listing instead of the traveller, no seats left to give, a 44px outline
 * Accept, and the deadline worded differently from the card on Bookings
 * ("answer within 24 min" there, "24 min left" here). One view, one card, so
 * the two screens cannot drift apart again (operator audit 5.3, 5.13).
 *
 * Worked out on the SERVER, every word of it, and handed to the client card
 * as plain strings: the card that holds an answer's Undo formats nothing, so
 * it cannot disagree with the server about a day or a clock (the node "Sept"
 * against the browser "Sep" the traveller app learned as a hydration error).
 */
export interface RequestView {
  id: string;
  /** "Reuben Mathai", or "The traveller" for a request that carries no name. */
  name: string;
  /** "Reuben", for "Reuben reads". */
  firstName: string;
  guests: number;
  /** "Reuben Mathai, 2 people". */
  title: string;
  /** "Snorkel trip to Elephant Beach · Today at 23:30". */
  trip: string;
  /**
   * The two halves of `trip`, for a card that sets each in its own voice: the
   * host's own name for the experience (null when the request carries none,
   * because the "A departure" standing in for it is ours), and when it leaves
   * ("" when the request carries no start).
   */
  experience: string | null;
  when: string;
  /** "Asked 2 h ago · Answer by 07:10", whatever of it is known. */
  asked: string;
  /** The clock, from the API's own minutes: "24 min left". */
  clock: string;
  /** An hour or less to answer. */
  urgent: boolean;
  /** "6 seats you can still give", or why the party does not fit. */
  seats: string;
  /** More people than seats that can be given: Accept would be a 409. */
  short: boolean;
  /** The reason a decline opens on, when the card already knows it. */
  preset: DeclineReason | null;
  /** The departure's zone, for a pay-by time the API does not write. */
  timezone: string;
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
const seats = (n: number) => `${n} ${n === 1 ? "seat" : "seats"}`;

export function requestView(
  request: OpenRequest,
  ctx: { at: number; today: string; tomorrow: string },
): RequestView {
  const timezone = request.timezone ?? "Asia/Kolkata";
  const name = request.contactName?.trim() || "The traveller";
  const guests = request.guests ?? 0;
  const grantable = request.seatsGrantable ?? 0;
  const short = !canGrant(request);

  const experience = request.experience?.trim() || null;
  const day = request.startsAt ? marketDayOf(request.startsAt, timezone) : null;
  const when =
    day && request.startsAt
      ? `${dayCaption(day, ctx.today, ctx.tomorrow, timezone)} at ${marketTime(request.startsAt, timezone)}`
      : "";
  const trip = [experience ?? "A departure", ...(when ? [when] : [])];

  /*
    The deadline as a clock time beside the countdown, the one phrasing both
    screens now use. The instant is the API's `expiresAt`, formatted in the
    departure's market time; the countdown is still the API's own
    `minutesToAnswer` and is never re-derived from it.
  */
  const asked: string[] = [];
  const age = requestAge(request.requestedAt, ctx.at);
  if (age) asked.push(age.charAt(0).toUpperCase() + age.slice(1));
  const by = request.expiresAt
    ? deadlineLabel(request.expiresAt, timezone, ctx.at)
    : "";
  if (by && (request.minutesToAnswer ?? 0) > 0) asked.push(`Answer by ${by}`);

  return {
    id: request.id ?? "",
    name,
    firstName: name.split(/\s+/)[0] || name,
    guests,
    title: `${name}, ${people(guests)}`,
    trip: trip.join(" · "),
    experience,
    when,
    asked: asked.join(" · "),
    clock: timeToAnswer(request.minutesToAnswer),
    urgent: urgencyOf(request.minutesToAnswer) === "critical",
    seats: short
      ? `Only ${seats(grantable)} left: not enough for this party`
      : `${seats(grantable)} you can still give`,
    short,
    /*
      A party the departure cannot hold already has its reason: full when
      nothing is left, too large when some is. Chosen for the operator to
      confirm or change, never sent on its own.
    */
    preset: short ? (grantable <= 0 ? "no_capacity" : "party_too_large") : null,
    timezone,
  };
}
