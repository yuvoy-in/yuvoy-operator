import type { components } from "@/lib/api/schema.gen";

/**
 * Earnings, and the one thing an operator needs from them: whether the number
 * can still move.
 *
 * Every figure is summed from amounts **frozen at capture**, so a commission
 * change today cannot restate what was earned last week. That is why the
 * screen shows the arithmetic rather than only the total — an operator
 * reconciling against their own book needs to see which line disagrees, not
 * just that something does.
 */

export type EarningsState =
  | "provisional"
  | "open"
  | "locked"
  | "approved"
  | "exported"
  | "settled"
  | "void";

export interface Earnings {
  from?: string;
  to?: string;
  bookings: number;
  grossPaise: number;
  commissionPaise: number;
  refundsPaise: number;
  netPaise: number;
  state: EarningsState;
}

export type ChangeRequest = components["schemas"]["ChangeRequest"];

/**
 * Whether this number can still change.
 *
 * The contract is explicit: "`state` is `provisional` until a payout period is
 * locked — say so in the UI, because nobody should plan against a number that
 * can still move." `open` is the same situation under a different name: the
 * period is still accruing.
 */
export function canStillMove(state: EarningsState): boolean {
  return state === "provisional" || state === "open";
}

/** What each state means to somebody who is owed money. */
export function describeState(state: EarningsState): string {
  switch (state) {
    case "provisional":
      return "Still adding up. Bookings can still complete, cancel or refund, so this figure can move.";
    case "open":
      return "This period is still running. The figure keeps changing until it closes.";
    case "locked":
      return "The period has closed and the figure is fixed. Awaiting review.";
    case "approved":
      return "Approved for payout. It has not been sent to the bank yet.";
    case "exported":
      return "Sent to the bank. It should land within a few working days.";
    case "settled":
      return "Paid. This period is closed and the money has left our side.";
    case "void":
      return "Cancelled. Nothing is owed for this period.";
  }
}

/**
 * A bank change that stops money moving.
 *
 * "A payout on hold because a bank change is in flight should say so — that is
 * a real state and the operator can act on it." Only the states before
 * `applied` hold anything: once applied, the new account is live and payouts
 * resume to it.
 */
export function payoutHold(requests: ChangeRequest[]): ChangeRequest | null {
  const holding = new Set(["objection_window", "pending", "cooling"]);
  return (
    requests.find((r) => r.kind === "bank" && holding.has(r.state ?? "")) ??
    null
  );
}

/**
 * Proves the totals add up, or says they do not.
 *
 * Not defensive programming — it is the screen's whole job. An operator
 * reconciling against their own book is asking "does your arithmetic work",
 * and a screen that renders `netPaise` without checking it against its own
 * components is answering a different question.
 */
export function reconciles(e: Earnings): boolean {
  return e.grossPaise - e.commissionPaise - e.refundsPaise === e.netPaise;
}

/** The calendar month containing a date, in the market's zone. */
export function monthRange(
  monthsAgo: number,
  now: number,
): { from: string; to: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
  }).format(new Date(now));
  const [y, m] = today.split("-").map(Number);

  const start = new Date(Date.UTC(y, m - 1 - monthsAgo, 1));
  const end = new Date(Date.UTC(y, m - monthsAgo, 0));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { from: iso(start), to: iso(end) };
}
