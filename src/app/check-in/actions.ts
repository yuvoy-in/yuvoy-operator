"use server";

import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { IDEMPOTENCY_KEY } from "@/lib/messages/send-key";
import { normaliseCode } from "@/lib/day/check-in-link";
import { marketDateLabel } from "@/lib/format/market-time";
import type { paths } from "@/lib/api/schema.gen";
import {
  NOT_A_CODE,
  UNSENT,
  type CheckInResult,
  type CheckInVia,
} from "./check-in-result";

/**
 * Checking a party in from the code they show (yuvoy-operator#175), over
 * `POST /check-ins` (`checkInByCode`).
 *
 * A Server Action for the reason every write here is one: `/operator/v1`
 * refuses CORS and the session is an httpOnly cookie, so the browser has
 * nothing to call with.
 *
 * ## One key per code, one body per key
 *
 * The API takes an `Idempotency-Key` on this write and fingerprints the body
 * with it. The screen holds one key per reference and code, and the body is
 * built here from those two and `via` alone, with no `seenAt`, so a resend
 * after a lost answer is the same bytes under the same key and checks them in
 * once. A key that is not the API's shape is not sent: the code still goes.
 *
 * ## A 404 is never success
 *
 * "A code that is not for one of your bookings answers 404, the same as one
 * that does not exist." It is said in the API's words and nobody is shown as
 * checked in.
 */

/** A dead session, which no code can fix. Not "that code did not work". */
const SESSION_ENDED_HERE =
  "Your session has ended. Sign in again, then check them in.";

/** The contract's own body, less `seenAt`, which is never sent from here. */
type CheckInBody = Omit<
  paths["/check-ins"]["post"]["requestBody"]["content"]["application/json"],
  "seenAt"
>;

export async function checkInWithCode(input: {
  code: string;
  reference?: string;
  via: CheckInVia;
  key?: string;
}): Promise<CheckInResult> {
  const { token } = await requireOperator();

  const code = normaliseCode(input.code);
  if (!code) return { ok: false, message: NOT_A_CODE };
  const body: CheckInBody = {
    code,
    via: input.via,
  };
  if (input.reference) body.reference = input.reference;

  const header =
    input.key && IDEMPOTENCY_KEY.test(input.key)
      ? { header: { "Idempotency-Key": input.key } }
      : {};

  try {
    const { data, error } = await operatorApi(token).POST("/check-ins", {
      params: { ...header },
      body,
    });
    if (error) throw error;
    return { ok: true, ...data };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { ok: false, message: UNSENT, retry: true };
    }
    if (err instanceof OperatorApiError) return refusal(err);
    throw err;
  }
}

/** Each declared refusal of `checkInByCode`, in the API's words or ours. */
function refusal(err: OperatorApiError): CheckInResult {
  if (err.isUnauthorized) {
    return { ok: false, message: SESSION_ENDED_HERE, signIn: true };
  }

  /*
    The key's own answers first. A resend while the first is still being
    written waits and goes again under the same key. One whose answer was
    lost is NOT sent again: it may have checked them in, and Today says so
    either way. A key that cannot be used again is a fault of ours.
  */
  if (err.code === "idempotency_in_progress") {
    return {
      ok: false,
      message:
        "That check-in is still on its way. Give it a moment, then try again. It only counts once.",
      retry: true,
    };
  }
  if (err.code === "idempotency_response_lost") {
    return {
      ok: false,
      message:
        "That check-in may have gone through, but its answer was lost. Open Today to see if they are checked in.",
      byName: true,
      newKey: true,
    };
  }
  if (
    err.code === "idempotency_key_reuse" ||
    err.code === "idempotency_key_malformed"
  ) {
    return { ok: false, message: TRY_AGAIN, retry: true, newKey: true };
  }

  const said = err.message.trim();
  switch (err.status) {
    case 400:
      // The API's 400 is lower case and names a field; ours says what to do.
      return {
        ok: false,
        message: namesField(err.details, "code")
          ? NOT_A_CODE
          : "That link is not complete. Nobody was checked in.",
        byName: true,
      };
    case 404:
      // Never success: a code that is not ours is the same as no code.
      return {
        ok: false,
        message: sentence(said, "This code is not for one of your bookings."),
        byName: true,
      };
    case 409:
      return { ok: false, message: conflict(err, said), byName: true };
    case 429:
      return {
        ok: false,
        message: sentence(
          said,
          "Too many codes did not match. Check people in by name for now.",
        ),
        byName: true,
      };
    case 503:
      return {
        ok: false,
        message: sentence(said, "Check-in by code is paused."),
        byName: true,
      };
    default:
      return { ok: false, message: TRY_AGAIN, retry: true, byName: true };
  }
}

const TRY_AGAIN = "That did not go. Nobody was checked in. Try again.";

/**
 * The 409s. `check_in_not_today` is said with the day in full from
 * `details.validOn`, because the API's sentence has no year; a booking that
 * is cancelled, declined or settled is said in our words, because the API
 * sends its store's error there.
 */
function conflict(err: OperatorApiError, said: string): string {
  if (err.code === "check_in_not_today") {
    const on = fieldOf(err.details, "validOn");
    return on && /^\d{4}-\d{2}-\d{2}$/.test(on)
      ? `This code is for ${marketDateLabel(on)}. Nobody was checked in.`
      : sentence(said, "This code is for another day.");
  }
  if (err.code === "not_on_this_departure") {
    return "This booking cannot be checked in. It is cancelled, declined or already settled.";
  }
  return sentence(said, "That code did not check anybody in.");
}

function fieldOf(details: unknown, field: string): string | null {
  if (typeof details !== "object" || details === null) return null;
  const value = (details as Record<string, unknown>)[field];
  return typeof value === "string" ? value : null;
}

function namesField(details: unknown, field: string): boolean {
  return typeof details === "object" && details !== null && field in details;
}

/*
  The API's sentences here are written for the person at the jetty ("Check
  them in by name if it is them.") and are shown as given. Its 400 is the
  one in lower case ("we could not read that check-in"), so a first letter is
  raised and a full stop added; an empty one falls back to ours.
*/
function sentence(said: string, fallback: string): string {
  if (!said) return fallback;
  const first = said[0].toUpperCase() + said.slice(1);
  return /[.!?]$/.test(first) ? first : `${first}.`;
}
