import "server-only";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { sentence } from "@/lib/format/sentence";
import { SUPPORT_PHONE } from "@/lib/site/contact";

/**
 * Asking for a sign-in code, and trading one for a session.
 *
 * ## Why this is shared rather than written twice
 *
 * Two doors reach it: `/sign-in`, and `/signup` since yuvoy-operator#20 made
 * creating an account and signing in one flow. Both need the same refusals said
 * the same way (a wrong code, a throttle, a closed account and no signal) and
 * two copies of that is two copies that drift. The portal already has an issue
 * open about exactly that failure in its phone fields (#19).
 *
 * **It writes no cookie.** `session-writes` may only be imported from a
 * `"use server"` module, because Next allows a cookie write in the action
 * phase and nowhere else — a write a rendering component can reach throws, and
 * the throw pre-empts the redirect beside it. So this returns the token and
 * each action writes it. `pnpm qa` enforces the boundary.
 *
 * ## What it deliberately does not decide
 *
 * Whether a particular code was delivered. `POST /auth/otp` answers the same
 * body for a number we know and one we do not, `sent` included, so nothing it
 * returns can say that THIS code reached anybody, and branching on it would
 * rebuild the directory the endpoint refuses to be.
 *
 * Where a requested code GOES is a different fact, and the screens now say it
 * (yuvoy-operator#91). Since yuvoy-api 67e3213 every code falls back to the
 * email address on the account while there is no WhatsApp sender, verified in
 * production on 20 September. That is policy, true of every request, so it is
 * said unconditionally beside the button that makes one; it is not something
 * this module is told per call, and nothing here pretends otherwise.
 */

/**
 * Says nothing about where the code came from, and takes the range the
 * contract allows rather than assuming six.
 */
export const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, "A code is digits and nothing else.");

/**
 * `devCode` is returned outside production so the flow can be exercised
 * without a messaging account. Gated on the mock flag as well as on the
 * server's own behaviour, so it cannot reach a production screen even if the
 * API ever returned one.
 */
const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

export type SendCode =
  { ok: true; devCode?: string } | { ok: false; message: string };

/**
 * The API's own words about one field of a `400`, when it sent any.
 *
 * `details` is `unknown` on the error and shaped per endpoint, so it is read
 * defensively: a string under the field's name, or nothing. The sign-in `400`
 * carries `details.phone`, "Enter your number with the country code, like
 * +919000000000.", which says what to fix where the envelope's message only
 * says what is missing.
 */
function fieldDetail(err: OperatorApiError, field: string): string | null {
  const details = err.details;
  if (!details || typeof details !== "object") return null;
  const value = (details as Record<string, unknown>)[field];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * `POST /auth/otp`.
 *
 * **The answer is identical for a number we know and one we do not** — same
 * status, same body. A caller must not branch on it: doing so would rebuild
 * the directory of "which businesses work with Yuvoy" that the endpoint is
 * carefully not.
 *
 * The two refusals it declares are each a different next step, so each gets
 * its own sentence: `429` is "wait", and `400` is "the number is wrong", which
 * no amount of waiting fixes. It used to fall to "try again shortly", and
 * trying again with the same number is the one thing that cannot work.
 */
export async function sendCode(phone: string): Promise<SendCode> {
  try {
    const { data, error } = await operatorApi().POST("/auth/otp", {
      body: { phone },
    });
    if (error) throw error;
    return { ok: true, devCode: MOCKING ? data.devCode : undefined };
  } catch (err) {
    if (err instanceof OperatorApiError && err.status === 429) {
      return {
        ok: false,
        message: "Too many attempts. Wait a minute and try again.",
      };
    }
    if (err instanceof OperatorApiError && err.status === 400) {
      /*
        The number, refused by the server's rule rather than the field's. The
        phone field already insists on ten digits after a fixed +91, so this is
        a rule the portal does not know about, and the server's sentence names
        it better than a paraphrase could. Through `sentence()` like every
        rendered refusal: it capitalises, ends the stop and strips a long dash.
      */
      return {
        ok: false,
        message:
          sentence(fieldDetail(err, "phone") ?? err.message) ||
          "That number was not accepted. Check it and try again.",
      };
    }
    if (err instanceof OperatorNetworkError) {
      return { ok: false, message: err.message };
    }
    return {
      ok: false,
      message: "We could not send a code just now. Try again shortly.",
    };
  }
}

export type CodeExchange =
  { ok: true; token: string } | { ok: false; message: string };

/**
 * `POST /auth/session` — a code for a session.
 *
 * Wrong, expired and used codes all answer 401 with one message, and this
 * keeps them one message: telling somebody a code was "already used" rather
 * than "wrong" tells an attacker they had the right number and the wrong
 * window. A throttle is a different next step — wait, do not ask for another —
 * so it gets its own sentence.
 *
 * So does `403 account_not_active`, the one refusal here that no retry can
 * clear. It fell to "try again shortly" before, which sent the owner of an
 * offboarded business round the same two screens until they gave up. The code
 * is right and the person is fine; the ACCOUNT cannot hold a session, and the
 * way forward is a person at Yuvoy, so the sentence says who and how. It
 * matches what `/account` says to the same state, in the same words.
 */
export async function exchangeCode(
  phone: string,
  code: string,
): Promise<CodeExchange> {
  try {
    const { data, error } = await operatorApi().POST("/auth/session", {
      body: { phone, code, device: "Yuvoy for operators (web)" },
    });
    if (error) throw error;
    if (!data.token) {
      return {
        ok: false,
        message: "We could not sign you in just now. Try again shortly.",
      };
    }
    return { ok: true, token: data.token };
  } catch (err) {
    if (err instanceof OperatorApiError && err.status === 429) {
      return {
        ok: false,
        message: "Too many attempts. Wait a minute, then try the code again.",
      };
    }
    if (err instanceof OperatorApiError && err.code === "account_not_active") {
      return {
        ok: false,
        message: `This business account is on hold, so it cannot be signed into. Call us on ${SUPPORT_PHONE}.`,
      };
    }
    if (err instanceof OperatorApiError && err.isUnauthorized) {
      return {
        ok: false,
        message: "That code did not work. Ask for a new one.",
      };
    }
    if (err instanceof OperatorApiError && err.status === 400) {
      /*
        The number or the code, refused by the server's rule rather than the
        form's: both are checked before this call, so it is one neither check
        knows. Our own words rather than the API's, which say "the code we
        sent" on a screen that is never told whether anything was sent.
      */
      return {
        ok: false,
        message: "Check the code, then try again. It is digits only.",
      };
    }
    if (err instanceof OperatorNetworkError) {
      return { ok: false, message: err.message };
    }
    return {
      ok: false,
      message: "We could not sign you in just now. Try again shortly.",
    };
  }
}
