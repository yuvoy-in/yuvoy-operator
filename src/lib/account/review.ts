import type { ChangeRequest } from "@/lib/account/change-kind";
import { dedash } from "@/lib/format/dedash";
import { SUPPORT_PHONE_HREF } from "@/lib/site/contact";
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
 * - `refused`: the newest one was rejected. Since yuvoy-api#223 the row may
 *   carry `rejectionReason`, a sentence written for the business ("never the
 *   words our staff typed"); absent, the screen says what happened and not
 *   why, and never invents a reason.
 * - `null` for everything else, INCLUDING a row older than the value on file:
 *   a logo set directly (a business that is not LIVE, or no longer is) after
 *   an earlier review is newer news than that review, whatever state it is
 *   stuck in.
 */

export type ReviewKind = "logo" | "profile";

export type Review =
  | { state: "waiting"; requestedAt: string | null }
  | { state: "refused"; requestedAt: string | null; reason: string | null };

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
  if (state === "rejected") {
    return {
      state: "refused",
      requestedAt,
      reason: rejectionReason(newest),
    };
  }
  return null;
}

/**
 * The API's sentence for a refusal (yuvoy-api#223), long dashes out, or null.
 * Present only on a rejected row somebody recorded a reason for.
 */
export function rejectionReason(
  row: Pick<ChangeRequest, "state" | "rejectionReason">,
): string | null {
  if (row.state !== "rejected") return null;
  const text = row.rejectionReason?.trim();
  if (!text) return null;
  /*
    Never a phone number that is not ours. The API's sentences say "Call us
    on +91 9531 000 000", which is not a Yuvoy number (owner, 24 Sep 2026; the
    published line is SUPPORT_PHONE), and an operator told why their bank
    change was refused would ring nobody. So a sentence naming any other
    number is held back and today's words are said instead; once the API's
    number is right, the sentence shows with no change here.
  */
  if (!onlyOurNumber(text)) return null;
  return dedash(text);
}

/** A run of digits long enough to be a phone number, spaces and hyphens allowed. */
const PHONE_NUMBER = /\+?\d[\d\s-]{8,}\d/g;

/** Whether every phone number in `text` is Yuvoy's published support line. */
export function onlyOurNumber(text: string): boolean {
  const ours = SUPPORT_PHONE_HREF.replace(/\D/g, "");
  for (const match of text.matchAll(PHONE_NUMBER)) {
    const digits = match[0].replace(/\D/g, "");
    // With or without the country code: "+91 81216 57657", "81216 57657".
    if (digits !== ours && !ours.endsWith(digits)) return false;
  }
  return true;
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
  /** The API's sentence for a refusal, when it sent one (yuvoy-api#223). */
  reason: string | null;
}

export function reviewNote(review: Review | null): ReviewNote | null {
  if (!review) return null;
  const ms = review.requestedAt ? Date.parse(review.requestedAt) : NaN;
  return {
    state: review.state,
    sentOn: Number.isNaN(ms) ? null : marketDateLabel(marketDate(new Date(ms))),
    reason: review.state === "refused" ? review.reason : null,
  };
}
