import { OperatorApiError } from "@/lib/api/errors";

/**
 * What `GET /me` just told us about the account, as one word.
 *
 * Two callers have to agree about this and they sit on opposite sides of a
 * redirect: `requireOperator()` decides where to send somebody, and `/account`
 * decides what to say when they arrive. A second copy of the branch is how a
 * portal ends up redirecting to a page that thinks nothing is wrong.
 *
 * ## What the contract actually publishes, and what it does not
 *
 * `GET /me` returns `id`, `name`, `roles`, `operatorId` and `canManage`. That
 * is the whole of it. There is **no account state, no approval stage and no
 * list of what is outstanding** anywhere in the operator document — the only
 * account-level signal it carries is a `403 account_not_active`, which the
 * contract glosses as "suspended or offboarded … the person is fine, the
 * business relationship is not".
 *
 * So this file draws the line exactly where the API draws it: an operator
 * learns whether they can trade, and nothing is invented about *why* or *what
 * is still needed*. Raised on yuvoy-api rather than filled in with a plausible
 * checklist — a screen that guessed at "waiting on your dive licence" would be
 * worse than no screen, because an operator would act on it.
 */
export type AccountStatus =
  /** `/me` answered. The account can trade. */
  | "active"
  /** 401 — no session, or one that is no longer valid. */
  | "signed-out"
  /** 403 `account_not_active` — suspended or offboarded. */
  | "not-active"
  /** Anything else: a 500, a timeout, no signal. Not an account state. */
  | "unknown";

export function classifyMeFailure(
  err: unknown,
): Exclude<AccountStatus, "active"> {
  if (err instanceof OperatorApiError) {
    if (err.isUnauthorized) return "signed-out";
    /*
      Branch on `code`, never on `message` or on the bare status. Messages are
      copy and will be edited; a 403 carrying some other code is a refusal this
      build does not understand, and calling it "suspended" would tell an
      operator their business relationship had ended because a server had a bad
      minute.
    */
    if (err.code === "account_not_active") return "not-active";
  }
  return "unknown";
}
