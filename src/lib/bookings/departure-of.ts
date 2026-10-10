import { marketDayOf } from "@/lib/day/calendar";
import type { OperatorSlot } from "@/lib/day/types";

/**
 * Which departure a booking is on, for an API that does not say. Since
 * yuvoy-api#259 `OperatorBooking.slotId` names it and this is not asked;
 * it stays for an API from before that, where absent means the old way.
 *
 * A booking says its listing and its start time; a departure is one listing
 * at one start time, so the pair finds it, read from `GET /slots` for the
 * booking's own market day. Exactly one match or none: two departures of one
 * listing at the same minute (a second boat added beside the first) get no
 * link rather than a guess, because a link to the wrong boat is a manifest
 * the operator would check people in on.
 */
export function departureOf(
  booking: { experienceId?: string; startsAt?: string },
  slots: readonly OperatorSlot[],
): string | null {
  if (!booking.experienceId || !booking.startsAt) return null;
  const at = Date.parse(booking.startsAt);
  if (Number.isNaN(at)) return null;
  const matches = slots.filter(
    (slot) =>
      slot.experienceId === booking.experienceId &&
      Date.parse(slot.startsAt) === at,
  );
  return matches.length === 1 ? matches[0].id : null;
}

/** The market day to read departures for, or null when the booking has none. */
export function departureDayOf(booking: {
  startsAt?: string;
  timezone: string;
}): string | null {
  return booking.startsAt
    ? marketDayOf(booking.startsAt, booking.timezone)
    : null;
}
