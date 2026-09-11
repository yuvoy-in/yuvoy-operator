import { dayCaption, marketTime } from "@/lib/format/market-time";
import { marketDayOf } from "./calendar";
import type { OpenRequest } from "./request-types";

/**
 * When a request's trip is, and how long ago it was asked — yuvoy-operator#43.
 *
 * "Each card shows: experience, request age, date, start time, guest name,
 * party size…" The clock on the row is still the server's `minutesToAnswer`;
 * these are the two facts beside it that tell an operator which boat and how
 * long somebody has been waiting.
 */

/**
 * How long ago a request was made — the demo's "12 min ago".
 *
 * Measured from the page's render time on the SERVER's clock, never the
 * phone's, for the reason `timeToAnswer` renders the server's own minutes: two
 * phones working out an age from their own clocks disagree. The page re-renders
 * on focus and every minute, so the age moves with it.
 */
export function requestAge(
  requestedAt: string | undefined,
  at: number,
): string | null {
  if (!requestedAt) return null;
  const then = Date.parse(requestedAt);
  if (Number.isNaN(then)) return null;
  // A clock a few seconds ahead of ours is "just now", never a negative age.
  const minutes = Math.floor((at - then) / 60_000);
  if (minutes < 1) return "asked just now";
  if (minutes < 60) return `asked ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `asked ${hours} h ago`;
  return `asked ${Math.floor(hours / 24)} d ago`;
}

/**
 * "Tomorrow at 09:00 · asked 12 min ago".
 *
 * The day is the MARKET's, from the departure's own zone — a 05:00 boat is on
 * its own morning, not the evening before — and it is said as a word when it
 * can be.
 */
export function requestWhen(
  request: Pick<OpenRequest, "startsAt" | "timezone" | "requestedAt">,
  at: number,
  today: string,
  tomorrow: string,
): string | null {
  const parts: string[] = [];
  const timeZone = request.timezone ?? "Asia/Kolkata";
  const day = request.startsAt ? marketDayOf(request.startsAt, timeZone) : null;
  if (day && request.startsAt) {
    parts.push(
      `${dayCaption(day, today, tomorrow, timeZone)} at ${marketTime(request.startsAt, timeZone)}`,
    );
  }
  const age = requestAge(request.requestedAt, at);
  if (age) parts.push(age);
  return parts.length > 0 ? parts.join(" · ") : null;
}
