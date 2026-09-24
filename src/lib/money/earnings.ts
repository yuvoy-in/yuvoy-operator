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
