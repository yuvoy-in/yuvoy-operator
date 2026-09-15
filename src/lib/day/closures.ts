import { BLACKOUT_REASONS } from "./capacity-types";

/**
 * Closures, read back from the API rather than inferred — yuvoy-operator#45.
 *
 * ## Why this file exists at all
 *
 * "Closed" used to be computed: every departure still running is `closed`, so
 * the day is closed. That is wrong in the one direction an operator notices. A
 * day with NO departures on it cannot be closed by that rule, so a shop that
 * closed a fortnight in January saw fourteen ordinary empty days and no sign
 * that anything had been done. And the rule could never say WHY, because a
 * status carries no reason.
 *
 * `GET /blackouts` answers both: what was closed, why, when, and which
 * departures each closure holds.
 *
 * ## In force, and the word is load-bearing
 *
 * "Every closure touching the range, reopened ones included; those carry
 * `reopenedAt`. A departure stays closed while any closure still in force holds
 * it." So a reopened closure is still returned, still readable, and must not
 * put Closed on anything. Reading the list without checking would show a day as
 * closed for the rest of the season after somebody reopened it.
 */

export interface Closure {
  id: string;
  from: string;
  to: string;
  reasonCode: string;
  note?: string;
  experienceId?: string;
  departureId?: string;
  reopenedAt?: string;
  departureIds: string[];
}

/** A closure that is still taking something off sale. */
export function inForce(closure: Closure): boolean {
  return !closure.reopenedAt;
}

/**
 * Why it was closed, in the operator's words.
 *
 * The six a person gives, plus `SCHEDULE_CHANGED`, which "is given only by
 * `PUT /experiences/{id}/schedule`" and never by anybody pressing a button. It
 * needs a label all the same: a day closed by a schedule save with no reason
 * beside it reads as a closure nobody can account for.
 */
const REASON_LABEL = new Map<string, string>([
  ...BLACKOUT_REASONS.map((r) => [r.code, r.label] as [string, string]),
  ["SCHEDULE_CHANGED", "Removed from the weekly schedule"],
]);

export function closureReason(code: string): string {
  /*
    An unrecognised code is printed as itself rather than dropped or guessed at.
    Dropping it says a day was closed for no reason; guessing says it was closed
    for the wrong one, and an operator plans a week around that.
  */
  return REASON_LABEL.get(code) ?? code;
}

/** Whether this closure's dates cover a market day. Both ends inclusive. */
export function covers(closure: Closure, day: string): boolean {
  return closure.from <= day && day <= closure.to;
}

/**
 * The closures that shut a WHOLE day: in force, covering it, and naming neither
 * a listing nor a departure.
 *
 * The two exclusions are what make the badge honest. A closure with an
 * `experienceId` shut one listing and the day's other boats still sail; one
 * with a `departureId` shut a single departure. Either drawn as "Closed" on the
 * day row would tell an operator their whole day is off when it is not, which
 * is the mistake that empties a boat nobody meant to empty.
 */
export function wholeDayClosures(
  closures: readonly Closure[],
  day: string,
): Closure[] {
  return closures.filter(
    (c) => inForce(c) && covers(c, day) && !c.experienceId && !c.departureId,
  );
}

/** Closures in force that shut one listing across this day. */
export function listingClosures(
  closures: readonly Closure[],
  day: string,
): Closure[] {
  return closures.filter(
    (c) => inForce(c) && covers(c, day) && c.experienceId && !c.departureId,
  );
}

/** Closures in force that shut one departure. */
export function departureClosures(
  closures: readonly Closure[],
  departureId: string,
): Closure[] {
  return closures.filter(
    (c) => inForce(c) && c.departureId === departureId && departureId !== "",
  );
}

/**
 * Every closure in force that touches a day, in the order the day should offer
 * them back: the whole day first, then a listing, then one departure.
 *
 * Widest first, because reopening the narrowest while the widest still holds
 * changes nothing an operator can see, and a list that offered them the other
 * way round invites exactly that. The API says so in its own answer:
 * `departuresStillClosed` is "departures still to come that stay closed,
 * because another closure in force also holds them."
 */
export function closuresTouching(
  closures: readonly Closure[],
  day: string,
  departureIds: readonly string[],
): Closure[] {
  const onDeparture = closures.filter(
    (c) =>
      inForce(c) &&
      c.departureId !== undefined &&
      departureIds.includes(c.departureId),
  );
  return [
    ...wholeDayClosures(closures, day),
    ...listingClosures(closures, day),
    ...onDeparture,
  ];
}

/** One closure as a sentence: why, and the note when there is one. */
export function closureLine(closure: Closure): string {
  const reason = closureReason(closure.reasonCode);
  return closure.note ? `${reason}. ${closure.note}` : reason;
}
