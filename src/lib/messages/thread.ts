import { marketDate, marketTime } from "@/lib/format/market-time";

/**
 * The conversation between a business and a booking's traveller — #52.
 *
 * ## The one rule that shapes every screen here
 *
 * **Neither side can type a phone number, an email address or a link.** That is
 * D-018 carried into the conversation: "you do not see a traveller's number, and
 * neither side can type one." The API enforces it and names what it found
 * without repeating any of the text, so the portal does no filtering of its own
 * (`## Do not build`) and renders the refusal it is given.
 *
 * ## And the one that shapes the data
 *
 * A message's text is removed a set time after the trip ends, and **the message
 * stays**: who wrote it, when, and `textRemovedAt` in place of `text`. "Show it
 * as a message whose text was removed, never as an empty one." An empty bubble
 * would read as somebody having sent nothing, which is a different and untrue
 * thing about a conversation an operator may be relying on.
 */

export type MessageFrom = "traveller" | "operator";

export interface ThreadMessage {
  id: string;
  from: MessageFrom;
  senderName: string;
  sentAt: string;
  /** Exactly one of these two. See `textRemoved`. */
  text?: string;
  textRemovedAt?: string;
}

/**
 * Whether this message's text is gone, decided by the field the API sets rather
 * than by the text being empty.
 *
 * The two are not the same question. `text` can be absent on a message whose
 * text was removed, and it must never be absent otherwise — "every message
 * carries exactly one of `text` and `textRemovedAt`". Reading emptiness would
 * also catch a hypothetical blank message and label it removed, which tells an
 * operator that something was said and then taken away.
 */
export function textRemoved(message: ThreadMessage): boolean {
  return typeof message.textRemovedAt === "string";
}

/** What a removed message says instead. The issue's copy, exactly. */
export const REMOVED_TEXT = "Message removed";

export type ClosedReason = "cancelled" | "declined" | "window_closed";

/**
 * Why the composer is not there, in the operator's terms.
 *
 * All three say the conversation can still be READ, because that is the part
 * somebody needs and the part a missing box does not say. An operator who
 * opens a cancelled booking looking for what was agreed should find it, not
 * conclude the history went with the booking.
 */
export function closedLine(reason: string | undefined): string {
  switch (reason) {
    case "cancelled":
      return "This booking was cancelled, so no more messages can be sent. The conversation can still be read.";
    case "declined":
      return "This booking was declined, so no more messages can be sent. The conversation can still be read.";
    case "window_closed":
      return "Messages for this trip are closed. The conversation can still be read.";
    default:
      /*
        `closedReason` is "present only when `canWrite` is `false`" — so an
        absent one here means a reason this build has not heard of, or a
        response that disagrees with itself. Said plainly rather than guessed
        at: naming the wrong reason tells somebody their booking was cancelled
        when it was not.
      */
      return "No more messages can be sent on this booking. The conversation can still be read.";
  }
}

/**
 * The id to send as `upTo` — the newest message actually on screen.
 *
 * "Send the id of a message actually drawn, never a later one." The endpoint
 * moves the marker to this message "and so to everything before it", so a
 * later id would mark read something nobody was shown, and the traveller's
 * question would be answered by nobody while the count said it had been seen.
 *
 * Pages arrive oldest-first, and older pages are prepended, so the newest is
 * the last element. Taken by position rather than by comparing `sentAt`: the
 * order is the API's and two messages can share a timestamp.
 */
export function newestMessageId(
  messages: readonly ThreadMessage[],
): string | null {
  const last = messages.at(-1);
  return last?.id ?? null;
}

/** "1 unread message" / "4 unread messages". Never drawn at zero. */
export function unreadLabel(total: number): string {
  return total === 1 ? "1 unread message" : `${total} unread messages`;
}

/**
 * "Tue 16 Sep" — a weekday, a day and a three-letter month.
 *
 * Built from `formatToParts` rather than taken from a format string, for one
 * reason: every English locale renders September as "Sept", and the four-letter
 * month is the odd one out in a column of three-letter ones. Slicing the month
 * part is safe for all twelve, and doing it here keeps the separator ours rather
 * than the locale's comma.
 */
export function shortDay(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month").slice(0, 3)}`;
}

/**
 * When a conversation was last written in: "12 min ago" up close, a weekday and
 * date once that stops meaning anything.
 *
 * The switch is at a day rather than at some number of hours, because the
 * question changes shape there. Inside today, "how long ago" is what somebody is
 * judging: a traveller who wrote 12 minutes ago is still holding their phone.
 * Past that, the useful fact is which day, and "31 hours ago" makes an operator
 * do arithmetic at six in the morning.
 *
 * `now` is passed in because `Date.now()` during render is impure and the React
 * compiler refuses it, the same rule `lastSeen` and `hasDeparted` follow.
 */
export function lastActivityLabel(
  iso: string | undefined,
  now: number,
  timeZone: string,
): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const minutes = Math.floor((now - then) / 60_000);
  /*
    A message from the near future is a clock disagreement, not one that has not
    been written yet. Said as "just now" rather than as a negative number of
    minutes, or as a date in the future that an operator would try to explain.
  */
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const sameDay =
    marketDate(new Date(now), timeZone) ===
    marketDate(new Date(then), timeZone);
  if (sameDay) {
    const hours = Math.floor(minutes / 60);
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  return shortDay(iso, timeZone);
}

/** A thread row's trip line: the day it departs, and the time. */
export function tripLine(startsAt: string | undefined, timeZone: string) {
  if (!startsAt) return null;
  return `${shortDay(startsAt, timeZone)}, ${marketTime(startsAt, timeZone)}`;
}

/* ------------------------------------------------- what the API returns -- */

/*
  These three shapes live HERE rather than beside the fetches that produce them,
  and the reason is a `pnpm qa` guard rather than taste: `fetch.ts` imports
  `server-only` and carries the session token, and a client component importing
  a type from it puts that module in the browser's import graph. TypeScript
  erases a type-only import, so nothing would break today — and the guard walks
  the graph statically because it is one edit away from becoming a value import.
*/

export interface BookingThread {
  messages: ThreadMessage[];
  complete: boolean;
  nextCursor?: string;
  unreadCount: number;
  canWrite: boolean;
  closedReason?: string;
  writableUntil?: string;
}

export interface ThreadRow {
  bookingId: string;
  reference: string;
  experience: string;
  startsAt?: string;
  /** The DEPARTURE's zone. A 7am dive shown as 1:30am is a missed boat. */
  timezone: string;
  lastMessageAt?: string;
  lastFrom?: string;
  unreadCount: number;
}

export interface ThreadPage {
  rows: ThreadRow[];
  complete: boolean;
  nextCursor?: string;
}
