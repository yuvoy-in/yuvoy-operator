"use server";

import { redirect } from "next/navigation";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { firstProblem, signUpBody, signUpSchema } from "@/lib/auth/signup";
import { codeSchema, exchangeCode, sendCode } from "@/lib/auth/code";
import { writeSessionToken } from "@/lib/auth/session-writes";

/**
 * O1 — an operator creates their own account, and is signed in at the end of
 * it.
 *
 * ## One flow, no detour (yuvoy-operator#20)
 *
 * It used to end on a panel explaining three things and a button back to
 * `/sign-in` — the thing they had just done the work for. Somebody who has
 * typed their business name and their own name has proved they are engaged,
 * and that is the worst possible moment to hand them a page of prose and a
 * detour. Now: submit → a code is asked for immediately, with no screen in
 * between → enter it → in the portal.
 *
 * The reassurance that moved off the old panel is not lost. "Creating an
 * account does not put you on sale" is what `/today` and `/account` say from
 * `AccountStanding` the moment they land, where it names what is outstanding
 * and who it is waiting on — reassurance they can act on, rather than an
 * obstacle before they can see anything.
 *
 * ## Why these actions have no `requireOperator()`
 *
 * There is no session yet; producing one is the point. Listed in
 * `UNAUTHENTICATED_ACTIONS` in `scripts/qa.mjs` with the reason written down,
 * so a further exemption cannot be added quietly.
 *
 * ## One code path still creates every operator session
 *
 * That property used to hold because signup sent people to `/sign-in`. It
 * still holds, more literally: both doors call `exchangeCode` in
 * `@/lib/auth/code`, and the cookie is written with the same
 * `writeSessionToken`. Two entrances, one exchange.
 */

export interface SignUpState {
  /** `details` collects the four fields; `code` finishes the sign-in. */
  step?: "details" | "code";
  message?: string;
  /** Which field the message belongs to, so the form can point at it. */
  field?: string;
  /**
   * What they typed, handed back so a refusal does not empty the form.
   *
   * React resets a form once its action completes, and these inputs are
   * uncontrolled — so without this, an operator who mistypes loses all four
   * fields and retypes them on a phone, in sunlight, with wet hands. The form
   * re-seeds from here and remounts on `attempt`.
   */
  values?: {
    businessName: string;
    name: string;
    phone: string;
    email: string;
  };
  /** Bumped per submission, so the form remounts and re-reads `values`. */
  attempt?: number;
  /** E.164, carried into the code step. The account exists by then. */
  phone?: string;
  /**
   * Development only. `POST /auth/otp` returns `devCode` outside production so
   * the flow can be exercised without a messaging account. Never rendered in
   * production — see `@/lib/auth/code`.
   */
  devCode?: string;
}

export async function createAccount(
  prev: SignUpState,
  form: FormData,
): Promise<SignUpState> {
  // Exactly as typed, never the parsed value: this is what goes back into the
  // fields, and re-seeding a trimmed or rewritten version of somebody's own
  // input under a red message is its own small confusion.
  const values = {
    businessName: String(form.get("businessName") ?? ""),
    name: String(form.get("name") ?? ""),
    phone: String(form.get("phone") ?? ""),
    email: String(form.get("email") ?? ""),
  };
  const attempt = (prev.attempt ?? 0) + 1;
  const refuse = (state: Omit<SignUpState, "values" | "attempt">) => ({
    ...state,
    values,
    attempt,
  });

  const parsed = signUpSchema.safeParse(values);

  if (!parsed.success) return refuse(firstProblem(parsed.error));

  try {
    const { error } = await operatorApi().POST("/auth/signup", {
      body: signUpBody(parsed.data),
    });
    if (error) throw error;

    /*
      The response is identical for a number that already has an account, and
      this action must not undo that. There is nothing in the `202` to branch
      on and nothing here tries: the next step is the same either way, which is
      exactly why the endpoint is safe to leave public — and it is why the code
      screen may not say "your account is created", a sentence that is false
      for half the people who would read it.
    */
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      // Nothing was created, so the honest thing is that it can be retried —
      // and retrying must not mean retyping.
      return refuse({ message: "No signal. Nothing was sent. Try again." });
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 429) {
        return refuse({
          message: "Too many attempts. Wait a minute and try again.",
        });
      }
      /*
        400 is rendered verbatim. The server validates more than this form can
        — a market that is not open, a name it will not take — and its sentence
        is more useful than a generic one. It is the same call the capacity
        screen makes with a 409.
      */
      if (err.status === 400 && err.message)
        return refuse({ message: err.message });
    }
    return refuse({
      message: "We could not set that up just now. Try again shortly.",
    });
  }

  /*
    The account exists from here, whatever happens next.

    So a failure to send the code must NOT go back to the details form: that
    would invite somebody to create the account they already have, and the
    second attempt would look identical to the first. The code step is where
    they belong, with a way to ask again.
  */
  const sent = await sendCode(parsed.data.phone);
  return {
    step: "code",
    phone: parsed.data.phone,
    devCode: sent.ok ? sent.devCode : undefined,
    message: sent.ok ? undefined : sent.message,
  };
}

/**
 * Ask for another code, from the code step.
 *
 * Needed because a code lasts a few minutes and the first one can fail to send
 * — and because the account already exists by then, so "start again" is not an
 * option that means anything.
 */
export async function resendCode(prev: SignUpState): Promise<SignUpState> {
  const phone = prev.phone ?? "";
  if (!phone) return { step: "details", message: "Start again." };

  const sent = await sendCode(phone);
  return {
    ...prev,
    step: "code",
    devCode: sent.ok ? sent.devCode : undefined,
    message: sent.ok ? undefined : sent.message,
  };
}

/**
 * The code, for a session — and straight into the portal.
 *
 * The same exchange `/sign-in` uses, so the two doors cannot drift about what
 * a wrong code or a throttle says. The cookie is written here rather than in
 * `@/lib/auth/code` because Next only allows a cookie write in the action
 * phase, and `pnpm qa` holds that boundary.
 */
export async function finishSignUp(
  prev: SignUpState,
  form: FormData,
): Promise<SignUpState> {
  const phone = prev.phone ?? "";
  if (!phone) return { step: "details", message: "Start again." };

  const parsed = codeSchema.safeParse(String(form.get("code") ?? ""));
  if (!parsed.success) {
    return { ...prev, step: "code", message: parsed.error.issues[0].message };
  }

  const result = await exchangeCode(phone, parsed.data);
  if (!result.ok) {
    return { ...prev, step: "code", message: result.message };
  }
  await writeSessionToken(result.token);

  /*
    Outside the try/catch above and after the cookie is written: `redirect`
    throws by design, and catching it would turn a successful sign-in into "we
    could not sign you in".

    `/today` rather than a welcome screen. `AccountStanding` is already on
    every page of the portal — a new account lands on a banner naming what is
    outstanding and who it is waiting on, which is the reassurance the old
    confirmation panel was trying and failing to give before they could see
    anything.
  */
  redirect("/today");
}
