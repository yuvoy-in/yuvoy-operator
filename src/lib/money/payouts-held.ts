import type { components } from "@/lib/api/schema.gen";
import { SUPPORT_PHONE } from "@/lib/site/contact";

/**
 * Whether the payout run is holding this business's money, and why:
 * `payoutsHeld` on `GET /me` (yuvoy-api#275, yuvoy-operator#156).
 *
 * The API answers it from the same check the payout run refuses on, so it
 * covers what the change list cannot show. The change list only knows a bank
 * change in flight. The second hold starts after that change goes live:
 * `destination_unconfirmed`, while our team has not yet updated the bank we
 * pay from to the new account. Until this was read, Money named the new
 * account as if the next payout were on its way there.
 *
 *   bank_change_in_progress  a bank change is in its objection window,
 *                            waiting for review, approved or cooling. No new
 *                            payout week is locked until it is stopped, or
 *                            goes live and the second hold clears.
 *   destination_unconfirmed  the change went live and our team has not yet
 *                            updated the bank we pay from. Nothing is locked
 *                            or paid, and nothing is needed from the business.
 *
 * When both apply the API names `bank_change_in_progress`, the first one the
 * run checks. The list is held to the contract's enum both ways, as
 * `change-kind.ts` holds its own.
 */
export type PayoutHoldReason = NonNullable<
  components["schemas"]["PayoutsHeld"]["reason"]
>;

export const PAYOUT_HOLD_REASONS = [
  "bank_change_in_progress",
  "destination_unconfirmed",
] as const satisfies readonly PayoutHoldReason[];

/**
 * The hold as this portal reads it: a known reason, `other` (held, for a
 * reason this build does not know), or `null` when nothing is held.
 */
export type PayoutsHeld = PayoutHoldReason | "other" | null;

/**
 * `payoutsHeld` as it may actually arrive, narrowed where it enters
 * (`requireOperator`).
 *
 * The contract makes `held` true exactly when `reason` is set. A body that
 * says one without the other is read as held, because telling an operator
 * the money is coming when the run will refuse it is the worse mistake.
 * Absent (an API before #275) is `null`: the screens then have only the
 * change list, which is what they read before.
 */
export function toPayoutsHeld(raw: unknown): PayoutsHeld {
  if (!raw || typeof raw !== "object") return null;
  const { held, reason } = raw as { held?: unknown; reason?: unknown };
  if (
    typeof reason === "string" &&
    (PAYOUT_HOLD_REASONS as readonly string[]).includes(reason)
  ) {
    return reason as PayoutHoldReason;
  }
  if (held === true || (typeof reason === "string" && reason.trim() !== "")) {
    return "other";
  }
  return null;
}

/**
 * The words in place of the account on Money's "To your bank" row, or `null`
 * when nothing holds the payout and the account is named.
 *
 * `listHold` is the change list's own hold (`payoutHold`); `held` is the
 * run's. Either one holding is enough: they are read in the same request and
 * agree in practice, and if they ever do not, saying "on hold" is the safe way
 * to be wrong. The same sentences as the operator app (yuvoy-mobile#47).
 */
export function heldDestinationLine(
  listHold: boolean,
  held: PayoutsHeld,
): string | null {
  if (held === "destination_unconfirmed") {
    return "On hold until we update our bank";
  }
  if (listHold || held === "bank_change_in_progress") {
    return "On hold until your bank change settles";
  }
  if (held === "other") return "On hold";
  return null;
}

/**
 * What Payout details says about a hold the change list cannot explain, or
 * `null` when there is nothing more to say.
 *
 * A bank change in progress is said only when no change is on screen to say
 * it (`changeShown`): its panel already carries the stage, both clocks and
 * the brake. That leaves the cases the list cannot show, the second hold
 * above all. The sentences are the operator app's (yuvoy-mobile#47), written
 * from the contract's description of each reason.
 */
export function payoutsHeldNotice(
  held: PayoutsHeld,
  { changeShown }: { changeShown: boolean },
): { title: string; body: string } | null {
  switch (held) {
    case null:
      return null;
    case "bank_change_in_progress":
      if (changeShown) return null;
      return {
        title: "Payouts are on hold while your bank change goes through",
        body: "No new payout week is locked for payment until the change is stopped or refused, or goes live and we have updated the bank we pay from. A week already locked for payment before the change was raised can still be paid, to the account on file.",
      };
    case "destination_unconfirmed":
      return {
        title: "Payouts are on hold until we update our bank",
        body: "Your new bank account is live. A person at Yuvoy still has to update the bank we pay from to match it, and nothing is paid until they do, so no money goes to the old account. Nothing is needed from you: payouts resume once we have updated our bank.",
      };
    case "other":
      return {
        title: "Payouts are on hold",
        body: `Call us on ${SUPPORT_PHONE} and we will tell you why.`,
      };
  }
}
