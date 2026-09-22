import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { suspendedMessage } from "@/lib/account/suspended";

/**
 * The session is gone, which no code can fix. A dead session is refused before
 * a code is even looked at, so it must not read as a wrong code: an owner told
 * "that code did not work" asks for another, types it, and is told the same.
 */
export const SESSION_ENDED =
  "Your session has ended. Sign in again, then ask for a new code.";

/**
 * What a refused step-up code means, one sentence per declared refusal.
 *
 * yuvoy-operator#90 f13: a wrong code and a suspended account both read "That
 * code did not work", which sent a suspended owner round asking for codes that
 * could never elevate anything, and hid the one fact that would let them act.
 * `POST /auth/step-up/verify` declares `401` and `403 account_suspended`:
 *
 *   - `403 account_suspended` first, in the API's words (`suspendedMessage`).
 *   - `401 session_expired`: the session ran out, which is not the code.
 *   - `401` otherwise: the code. "Wrong, expired and used all answer the same
 *     way", deliberately, and so does this.
 *   - anything else is ours, not theirs: a failure to check is not a wrong
 *     code, and saying it was sends them for a new one they do not need.
 *
 * Apart from the Server Action that calls it because a `"use server"` module
 * may export nothing but actions, and so it can be tested without one.
 */
export function stepUpRefusal(err: unknown): {
  message: string;
  /** The code field is marked only when the code is what is wrong. */
  field?: "code";
} {
  if (err instanceof OperatorNetworkError) {
    return { message: "No signal. Nothing was changed." };
  }
  if (err instanceof OperatorApiError) {
    const refusal = suspendedMessage(err);
    if (refusal) return { message: refusal };
    if (err.code === "session_expired") return { message: SESSION_ENDED };
    if (err.isUnauthorized) {
      return {
        field: "code",
        message: "That code did not work. Ask for a new one.",
      };
    }
  }
  return {
    message:
      "We could not check the code just now. Nothing was changed. Try again.",
  };
}
