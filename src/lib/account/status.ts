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
 * `GET /me` returns `id`, `name`, `roles`, `operatorId` and `canManage`, and
 * now an `account` block. The account-level signals are that block and a
 * `403 account_not_active`, and since yuvoy-operator#50 they mean different
 * things: `account_not_active` is an OFFBOARDED account that cannot hold a
 * session, and a suspended, closed or disqualified BUSINESS signs in normally
 * and carries `account.suspension` instead.
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
  /**
   * 403 `account_not_active` — the ACCOUNT was offboarded, so it cannot sign
   * in or hold a session at all.
   *
   * No longer "suspended or offboarded" (yuvoy-operator#50). The contract
   * separated them: "a suspended business is not refused here, and nor is one
   * whose status is `OFFBOARDED` or `DISQUALIFIED`: each signs in, and its
   * writes answer `account_suspended` instead." A suspended business gets a
   * `200` from `GET /me` and is read from `account.suspension`.
   *
   * Keeping the old gloss would send a suspended operator to a dead end, and
   * they are exactly the operator who must not hit one: the trips they have
   * already sold still have to be run or called off, and travellers have paid
   * for them.
   */
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
    /*
      A suspended business must never reach here. Its `GET /me` answers 200, so
      the only way a `403 account_suspended` could arrive on this path is a
      deployment where the two have not separated yet. It is deliberately NOT
      mapped to "not-active": that would resurrect the dead end this issue
      removed. It falls to "unknown", which says less and claims nothing.
    */
  }
  return "unknown";
}
