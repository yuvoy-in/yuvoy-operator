import { OperatorApiError } from "@/lib/api/errors";
import { SUPPORT_PHONE } from "@/lib/site/contact";

/**
 * A right code that no retry can turn into a session, said with who can help,
 * or `null` for any other answer.
 *
 * Signing in and both doors that accept an invitation answer the same two
 * `403`s, only after the code has checked out, and the way forward from
 * either is a person at Yuvoy:
 *
 *   account_not_active        the business is offboarded. On an invitation
 *                             it was offboarded between the join and the
 *                             session, so signing in will not help either.
 *   account_deletion_pending  this number closed its login and the request
 *                             to erase it is still open (yuvoy-api#274).
 *                             Nothing changed and nobody joined.
 *
 * Read by its code, as sign-in always has. Each fell to "try again" on one
 * door or another, which is the one instruction that cannot work. Our words
 * rather than the API's, which say "contact support" and give no number.
 */
export function closedDoorMessage(err: unknown): string | null {
  if (!(err instanceof OperatorApiError)) return null;
  if (err.code === "account_not_active") {
    // The same words `/account` uses for the same state.
    return `This business account is on hold, so it cannot be signed into. Call us on ${SUPPORT_PHONE}.`;
  }
  if (err.code === "account_deletion_pending") {
    return `Your login was closed and is being deleted, so it cannot be signed into. If you did not mean to close it, call us on ${SUPPORT_PHONE}.`;
  }
  return null;
}
