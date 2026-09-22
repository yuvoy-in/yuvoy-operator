"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { codeSchema, exchangeCode, sendCode } from "@/lib/auth/code";
import { HOME_PATH, safeReturnPath } from "@/lib/auth/return-to";
import { writeSessionToken } from "@/lib/auth/session-writes";

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
   * The number exactly as typed, handed back when it is refused.
   *
   * React resets a form once its action completes and this input is
   * uncontrolled, so without it a mistyped country code emptied the field and
   * the operator retyped thirteen digits — on a phone, in sunlight. Raw
   * rather than normalised: re-seeding a rewritten version of somebody's own
   * input under a red message is its own small confusion.
   */
  typed?: string;
  /** Bumped per submission, so the form remounts and re-reads `typed`. */
  attempt?: number;
  /**
   * Where to land afterwards, when they were bounced off somewhere.
   *
   * Carried in the state as well as the form because the code step is a second
   * submission. Re-validated at the redirect regardless of how it arrived —
   * both routes into it are client-controlled.
   */
  next?: string;
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

export async function requestCode(
  _prev: SignInState,
  form: FormData,
): Promise<SignInState> {
  const typed = String(form.get("phone") ?? "");
  const attempt = (_prev.attempt ?? 0) + 1;
  const parsed = phoneSchema.safeParse(typed);
  if (!parsed.success) {
    return {
      step: "phone",
      message: parsed.error.issues[0].message,
      typed,
      attempt,
    };
  }

  const next = safeReturnPath(String(form.get("next") ?? "")) ?? undefined;

  const sent = await sendCode(parsed.data);
  if (!sent.ok) {
    return { step: "phone", message: sent.message, typed, attempt, next };
  }

  /*
    The response is identical for a number we know and one we do not — same
    status, same body — and this screen must not undo that. Moving to the code
    step either way is not a UI convenience: branching here would rebuild the
    directory of "which businesses work with Yuvoy" that the endpoint is
    carefully not.
  */
  return { step: "code", phone: parsed.data, devCode: sent.devCode, next };
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

  /*
    The same exchange `/signup` finishes on, so the two doors cannot drift
    about what a wrong code or a throttle says. The cookie is written here
    rather than inside it because Next allows a cookie write in the action
    phase and nowhere else, and `pnpm qa` holds that boundary.
  */
  const result = await exchangeCode(phone, parsed.data);
  if (!result.ok) {
    return { ...prev, step: "code", message: result.message };
  }
  await writeSessionToken(result.token);

  /*
    Back to where they were headed, if that survived validation.

    Checked here rather than trusted from the state: `next` reaches this action
    through a hidden input, which is client-controlled, and an unchecked value
    would be an open redirect fired at the exact moment somebody has signed in
    successfully and is most inclined to trust the next page.

    Outside any try: `redirect` throws by design, and catching it here would
    turn a successful sign-in into "we could not sign you in".
  */
  const back =
    safeReturnPath(prev.next ?? String(form.get("next") ?? "")) ?? HOME_PATH;
  redirect(back);
}

export async function signOut(): Promise<void> {
  const { clearSessionToken } = await import("@/lib/auth/session-writes");
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
 *   - It sends a code somewhere they cannot read it: to the email address on
 *     the account, or nowhere at all when the account has none, which is the
 *     whole reason they are on this path (yuvoy-operator#91).
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
  const typed = String(form.get("phone") ?? "");
  const parsed = phoneSchema.safeParse(typed);
  if (!parsed.success) {
    return {
      step: "phone",
      message: parsed.error.issues[0].message,
      typed,
      attempt: (_prev.attempt ?? 0) + 1,
    };
  }
  return {
    step: "code",
    phone: parsed.data,
    existing: true,
    next: safeReturnPath(String(form.get("next") ?? "")) ?? undefined,
  };
}
