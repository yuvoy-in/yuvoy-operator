"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { writeSessionToken } from "@/lib/auth/session";

/**
 * O2 — the operator signs in.
 *
 * Two Server Actions, no client-side API calls, and the session token never
 * exists in JavaScript: `POST /auth/session` is called here and the answer
 * goes straight into an httpOnly cookie.
 */

export interface SignInState {
  step: "phone" | "code";
  phone?: string;
  message?: string;
  /**
   * They arrived at the code step holding a code already, so nothing was sent.
   *
   * Kept so the screen can avoid implying a delivery that did not happen —
   * and NOT so it can name a channel. See the sign-in copy rule in `pnpm qa`.
   */
  existing?: boolean;
  /**
   * Development only. `POST /auth/otp` returns `devCode` when the service runs
   * outside production, so the flow can be exercised without an SMS account.
   * Carried through so a reviewer can sign in locally, and gated on the flag
   * so it cannot reach a production screen even if the API ever returned one.
   */
  devCode?: string;
}

/** E.164. The API wants it; the operator types whatever is on their phone. */
const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s()-]/g, ""))
  .pipe(
    z
      .string()
      .regex(
        /^\+[1-9]\d{7,14}$/,
        "Enter the number with its country code, like +919000000101.",
      ),
  );

const codeSchema = z
  .string()
  .trim()
  /*
    Says nothing about where the code came from. It may have arrived by
    WhatsApp or been issued by Yuvoy out of band, and this screen is never told
    which — see yuvoy-api#59 and the sign-in copy rule in `pnpm qa`.
  */
  .regex(/^\d{4,8}$/, "A code is digits and nothing else.");

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

export async function requestCode(
  _prev: SignInState,
  form: FormData,
): Promise<SignInState> {
  const parsed = phoneSchema.safeParse(String(form.get("phone") ?? ""));
  if (!parsed.success) {
    return { step: "phone", message: parsed.error.issues[0].message };
  }

  try {
    const { data, error } = await operatorApi().POST("/auth/otp", {
      body: { phone: parsed.data },
    });
    if (error) throw error;

    /*
      The response is identical for a number we know and one we do not — same
      status, same body — and this screen must not undo that. Moving to the
      code step either way is not a UI convenience: branching here would
      rebuild the directory of "which businesses work with Yuvoy" that the
      endpoint is carefully not.
    */
    return {
      step: "code",
      phone: parsed.data,
      devCode: MOCKING ? data.devCode : undefined,
    };
  } catch (err) {
    if (err instanceof OperatorApiError && err.status === 429) {
      return {
        step: "phone",
        message: "Too many attempts. Wait a minute and try again.",
      };
    }
    if (err instanceof OperatorNetworkError) {
      return { step: "phone", message: err.message };
    }
    return {
      step: "phone",
      message: "We could not send a code just now. Try again shortly.",
    };
  }
}

export async function submitCode(
  prev: SignInState,
  form: FormData,
): Promise<SignInState> {
  const phone = prev.phone ?? String(form.get("phone") ?? "");
  const parsed = codeSchema.safeParse(String(form.get("code") ?? ""));
  if (!parsed.success) {
    return { ...prev, step: "code", message: parsed.error.issues[0].message };
  }

  try {
    const { data, error } = await operatorApi().POST("/auth/session", {
      body: {
        phone,
        code: parsed.data,
        device: "Yuvoy for operators (web)",
      },
    });
    if (error) throw error;
    if (!data.token) throw new Error("The server returned no session token.");

    await writeSessionToken(data.token);
  } catch (err) {
    if (err instanceof OperatorApiError && err.isUnauthorized) {
      /*
        Wrong, expired, used and over-attempted codes all answer 401 with one
        message, and this screen keeps them one message. Telling somebody the
        code was "already used" rather than "wrong" tells an attacker they had
        the right number and the wrong window.
      */
      return {
        ...prev,
        step: "code",
        message: "That code did not work. Ask for a new one.",
      };
    }
    if (err instanceof OperatorNetworkError) {
      return { ...prev, step: "code", message: err.message };
    }
    return {
      ...prev,
      step: "code",
      message: "We could not sign you in just now. Try again shortly.",
    };
  }

  // Outside the try: `redirect` throws by design, and catching it here would
  // turn a successful sign-in into "we could not sign you in".
  redirect("/today");
}

export async function signOut(): Promise<void> {
  const { clearSessionToken } = await import("@/lib/auth/session");
  const { readSessionToken } = await import("@/lib/auth/session");

  const token = await readSessionToken();
  if (token) {
    try {
      // Revoke it server-side too. A cleared cookie on one phone leaves a live
      // session for whoever else has the token.
      await operatorApi(token).DELETE("/auth/session", {});
    } catch {
      // Signing out locally must succeed even when the API cannot be reached.
    }
  }
  await clearSessionToken();
  redirect("/sign-in");
}

/**
 * Straight to the code field, without asking for a code to be sent.
 *
 * Yuvoy staff can issue a sign-in code out of band (`yuvoy-api#59`, ruled
 * **keep** on 2 September with step-up and a notice to the operator's backup
 * number). That is the hedge for an operator whose phone is gone — which is
 * precisely the operator who must not be made to press "Send me a code".
 *
 * Two reasons that button is the wrong door for them:
 *
 *   - It fires a WhatsApp send to a phone they do not have, which is the whole
 *     reason they are on this path.
 *   - **If issuing a code supersedes an outstanding one, it destroys the code
 *     they are holding** — burning their only way in at the moment they are
 *     using it. Whether it does is asked on #59; this path is correct either
 *     way, which is why it is not waiting on the answer.
 *
 * No API call at all. The phone is validated with the same rule the send path
 * uses, and `POST /auth/session` remains the only gate — skipping the send
 * skips nothing that authorises anybody.
 */
/*
  Named `enterExistingCode` rather than `useExistingCode`: a function whose
  name begins with `use` is a React Hook as far as ESLint is concerned, and it
  refuses one called inside a callback — which is exactly where a Server Action
  gets dispatched from. A real error, not a lint quirk.
*/
export async function enterExistingCode(
  _prev: SignInState,
  form: FormData,
): Promise<SignInState> {
  const parsed = phoneSchema.safeParse(String(form.get("phone") ?? ""));
  if (!parsed.success) {
    return { step: "phone", message: parsed.error.issues[0].message };
  }
  return { step: "code", phone: parsed.data, existing: true };
}
