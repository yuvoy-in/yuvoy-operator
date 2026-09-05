import "server-only";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";

/**
 * Asking for a sign-in code, and trading one for a session.
 *
 * ## Why this is shared rather than written twice
 *
 * Two doors reach it: `/sign-in`, and `/signup` since yuvoy-operator#20 made
 * creating an account and signing in one flow. Both need the same three
 * refusals said the same way — a wrong code, a throttle, and no signal — and
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
 * Nothing here says where a code came from. It may have arrived by WhatsApp or
 * been issued by Yuvoy out of band (yuvoy-api#59), `POST /auth/session` is
 * never told which, and the copy on both screens must be true of both. There
 * is no channel in this module's vocabulary at all.
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
 * `POST /auth/otp`.
 *
 * **The answer is identical for a number we know and one we do not** — same
 * status, same body. A caller must not branch on it: doing so would rebuild
 * the directory of "which businesses work with Yuvoy" that the endpoint is
 * carefully not.
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
    if (err instanceof OperatorApiError && err.isUnauthorized) {
      return {
        ok: false,
        message: "That code did not work. Ask for a new one.",
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
