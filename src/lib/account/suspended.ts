import { OperatorApiError } from "@/lib/api/errors";
import { sentence } from "@/lib/format/sentence";
import { WRITES_ALLOWED_WHILE_SUSPENDED } from "./standing";

/**
 * A write refused because the business is suspended, closed or disqualified.
 *
 * Every write in this portal can meet this, and it has to be answered BEFORE
 * the role branch. Both are `403`, and the role sentence is the wrong one: an
 * owner told "your role cannot do this" about their own business, on a screen
 * that offers no way forward, will ring us. The API sends the true sentence
 * and the contract says why it does: `message` is "the owner's sentence for
 * the status, which every refused write answers with too, so a banner and a
 * tapped button never disagree".
 *
 * So the portal renders the API's words rather than writing its own. There are
 * three of them, one per status, and inventing a fourth would put a sentence
 * on screen that no admin ever wrote.
 *
 * Through `sentence()` like every other rendered refusal: it capitalises, ends
 * the stop, and strips a long dash the API's prose might carry, which the copy
 * rule cannot reach from here.
 */
export function suspendedMessage(err: unknown): string | null {
  if (!(err instanceof OperatorApiError)) return null;
  if (err.code !== "account_suspended") return null;
  return sentence(err.message) || "Your account cannot make this change.";
}

/**
 * Whether this write is still drawn while the business is suspended.
 *
 * `suspension` absent means nothing is suspended and every control is drawn as
 * it always was: role gates still decide on top, unchanged.
 *
 * Suspended, the answer comes from `WRITES_ALLOWED_WHILE_SUSPENDED`, which is
 * the API's own list. The principle underneath it is worth keeping in mind
 * when adding a control: a suspended business can always let a traveller GO
 * (cancel a booking, decline a request, call a departure off, give cash back)
 * and can never take one ON (accept, add departures, seats, counter sales, put
 * a listing back on sale). Everything can still be READ.
 *
 * Drawing a button the API will refuse is the failure this prevents. The
 * operator taps it, reads the suspension sentence, and learns only that the
 * portal offered them something it knew would fail.
 */
export function drawWhileSuspended(
  suspension: unknown,
  endpoint: (typeof WRITES_ALLOWED_WHILE_SUSPENDED)[number] | (string & {}),
): boolean {
  if (!suspension) return true;
  return (WRITES_ALLOWED_WHILE_SUSPENDED as readonly string[]).includes(
    endpoint,
  );
}
