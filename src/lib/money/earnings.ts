import { BANK_CHANGE, type ChangeRequest } from "@/lib/account/change-kind";

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

export type { ChangeRequest };

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
    requests.find(
      (r) => r.kind === BANK_CHANGE && holding.has(r.state ?? ""),
    ) ?? null
  );
}

/** Where the next payout goes. See `payoutDestination`. */
export type PayoutDestination =
  { kind: "held" } | { kind: "account"; line: string };

/**
 * Where the next payout goes, said inside it (operator A, approved 3 Oct
 * 2026: "the bank the payout goes to shown inside the payout").
 *
 *   held     a bank change is in flight, or the payout run says it is holding
 *            the money (`payoutsHeld`, yuvoy-operator#156). Nothing moves
 *            until it clears, so no account is named: which one is paid is
 *            the change's to decide, or is the new one only once we have
 *            updated the bank we pay from. The row says why instead
 *            (`heldDestinationLine`).
 *   account  the account on file, in the words Payout details uses.
 *   null     nothing is sent (a week that pays nothing, or one owed back), or
 *            no account is on file (one set up by hand before any change was
 *            made here). The screen then claims nothing either way.
 */
export function payoutDestination(
  netPaise: number,
  onFileLine: string | null,
  held: boolean,
): PayoutDestination | null {
  if (!(netPaise > 0)) return null;
  if (held) return { kind: "held" };
  return onFileLine ? { kind: "account", line: onFileLine } : null;
}
