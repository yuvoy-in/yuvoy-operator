import type { ChangeRequest } from "@/lib/account/change-kind";
import { marketDate, marketDateLabel } from "@/lib/format/market-time";

/**
 * Whether a change to the logo or the business details is waiting on Yuvoy.
 *
 * ## Why this reads `GET /change-requests`
 *
 * On a LIVE business a new logo or new registered details are RECORDED FOR
 * REVIEW rather than applied (D-032.3). The write answers `202` and the
 * screen can say so once, in the receipt (yuvoy-operator#89 f10). But neither
 * `GET /logo` nor `GET /profile` says a change is waiting, so after a reload
 * the screen showed the old value and nothing else, and the operator's only
 * way to find out whether we got it was to send it again.
 *
 * The API files each of these as a row in the same table bank changes use
 * (`operator_change_requests`, kind `logo` or `profile`), and
 * `GET /change-requests` lists every kind, newest first. So the answer is
 * already there, with no API change: the newest row of the kind.
 *
 * The two screens that already read this list (Earnings and Payout details)
 * both filter on the bank's kind (`BANK_CHANGE`, `bank_account`), so these rows cannot be mistaken there for
 * a bank change holding a payout.
 *
 * ## Two answers, and silence
 *
 * - `waiting`: in any state before a decision. Only `pending` is used for
 *   these kinds today; the objection window and the cooling period are the
 *   bank change's, and are read the same way because the enum is shared.
 * - `refused`: the newest one was rejected. The row carries no reason, so the
 *   screen says what happened and not why.
 * - `null` for everything else, INCLUDING a row older than the value on file:
 *   a logo set directly (a business that is not LIVE, or no longer is) after
 *   an earlier review is newer news than that review, whatever state it is
 *   stuck in.
 */

export type ReviewKind = "logo" | "profile";

export type Review =
  | { state: "waiting"; requestedAt: string | null }
  | { state: "refused"; requestedAt: string | null };

const WAITING = new Set(["pending", "objection_window", "cooling"]);

export function reviewOf(
  requests: ChangeRequest[],
  kind: ReviewKind,
  /** When the value on file was last set: `uploadedAt`, `submittedAt`. */
  appliedAt?: string | null,
): Review | null {
  const newest = requests
    .filter((r) => r.kind === kind)
    /*
      Sorted here rather than trusting the order it arrives in. The API sends
      newest first today, and a screen that says "waiting" about a change
      that was decided an hour ago is the one this exists to prevent.
    */
    .sort((a, b) => instant(b.requestedAt) - instant(a.requestedAt))[0];
  if (!newest) return null;

  const requestedAt = newest.requestedAt ?? null;
  if (appliedAt && requestedAt && instant(requestedAt) <= instant(appliedAt)) {
    return null;
  }

  const state = newest.state ?? "";
  if (WAITING.has(state)) return { state: "waiting", requestedAt };
  if (state === "rejected") return { state: "refused", requestedAt };
  return null;
}

/** Milliseconds, or 0 for a missing or unreadable time (sorts it last). */
function instant(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * What a screen needs to say about a review: its state, and the day it was
 * sent in the market's calendar, already written out.
 *
 * Formatted HERE, on the server, and handed down as a string. The details
 * form is a client component, and a date formatted on both sides of hydration
 * is a date the two sides can disagree about.
 */
export interface ReviewNote {
  state: Review["state"];
  /** "21 September 2026", or null when the row did not say. */
  sentOn: string | null;
}

export function reviewNote(review: Review | null): ReviewNote | null {
  if (!review) return null;
  const ms = review.requestedAt ? Date.parse(review.requestedAt) : NaN;
  return {
    state: review.state,
    sentOn: Number.isNaN(ms) ? null : marketDateLabel(marketDate(new Date(ms))),
  };
}
