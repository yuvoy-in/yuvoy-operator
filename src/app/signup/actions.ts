"use server";

import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { firstProblem, signUpBody, signUpSchema } from "@/lib/auth/signup";

/**
 * O1 — an operator creates their own account.
 *
 * ## Why this action has no `requireOperator()`
 *
 * There is no session yet; producing an account is the point. `POST
 * /auth/signup` carries no security requirement in the contract for the same
 * reason `POST /team/accept` does not. It is listed in `UNAUTHENTICATED_ACTIONS`
 * in `scripts/qa.mjs` with that reason written down, so a third exemption
 * cannot be added quietly.
 *
 * ## What it deliberately does NOT do
 *
 * **It does not sign anybody in.** `POST /auth/signup` mints no session — it
 * answers `202` and the operator signs in through the ordinary flow, so one
 * code path creates operator sessions rather than two. That is the same call
 * O5's `/join` makes, and for the same reason.
 */

export interface SignUpState {
  message?: string;
  /** Which field the message belongs to, so the form can point at it. */
  field?: string;
  /**
   * What they typed, handed back so a refusal does not empty the form.
   *
   * React resets a form once its action completes, and these inputs are
   * uncontrolled — so without this, an operator who forgets a country code
   * loses all four fields and retypes them on a phone, in sunlight, with wet
   * hands. The form re-seeds from here and remounts on `attempt`.
   */
  values?: {
    businessName: string;
    name: string;
    phone: string;
    email: string;
  };
  /** Bumped per submission, so the form remounts and re-reads `values`. */
  attempt?: number;
  /** Set once the API has accepted. Carries the number, to sign in with. */
  done?: { phone: string };
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
      exactly why the endpoint is safe to leave public.
    */
    return { done: { phone: parsed.data.phone } };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      // Nothing was created, so the honest thing is that it can be retried —
      // and retrying must not mean retyping.
      return refuse({ message: "No signal. Nothing was sent — try again." });
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
}
