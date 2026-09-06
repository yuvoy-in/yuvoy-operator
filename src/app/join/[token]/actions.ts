"use server";

import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { codeSchema } from "@/lib/auth/code";

/**
 * Joining a business from its link — yuvoy-operator#23.
 *
 * ## Why these actions have no `requireOperator()`
 *
 * The person here has no account, which is the entire point. All three
 * endpoints carry `security: []` in the contract for the same reason
 * `POST /auth/signup` does. Listed in `UNAUTHENTICATED_ACTIONS` in
 * `scripts/qa.mjs` with that reason written down.
 *
 * ## The one that is not like the others
 *
 * `POST /join/{token}/accept` can answer **409 `confirmation_required`**: this
 * number already works with another business, and accepting ends that. "One
 * number works with one business at a time. The previous membership is ended
 * and its sessions dropped." That is somebody losing access to their current
 * employer's manifest mid-shift, so it is never sent by default — the screen
 * asks, and `confirmLeaving` goes only after they have agreed.
 */

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9]\d{7,14}$/, "Enter your number.");

export interface JoinState {
  step: "phone" | "code" | "done";
  message?: string;
  /** E.164, carried between steps. */
  phone?: string;
  /** What they are joining as, from the code step. */
  invited?: { businessName?: string; role?: string; name?: string };
  /**
   * The business they would be leaving, named by the API.
   *
   * Present means accepting is destructive. The screen must ask before it
   * sends `confirmLeaving`, and this is what it has to name.
   */
  leavingBusiness?: string;
  /** Whatever the API wants said about that. Rendered verbatim. */
  note?: string;
  /** Development only, exactly as everywhere else. Never in production. */
  devCode?: string;
}

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

/**
 * Ask for a code.
 *
 * A number nobody invited is refused **before anything is sent**, and the
 * contract is explicit that this is deliberate: "the alternative is a page
 * that fires one-time codes at any phone somebody types, which is a free SMS
 * gateway pointed at strangers." So the 404 is rendered rather than softened —
 * its message "names the business and says to ask its owner or an admin to
 * send one … render it, because it is the only useful next step."
 */
export async function requestJoinCode(
  token: string,
  prev: JoinState,
  form: FormData,
): Promise<JoinState> {
  const parsed = phoneSchema.safeParse(String(form.get("phone") ?? ""));
  if (!parsed.success) {
    return { step: "phone", message: parsed.error.issues[0].message };
  }

  try {
    const { data, error } = await operatorApi().POST("/join/{token}/code", {
      params: { path: { token } },
      body: { phone: parsed.data },
    });
    if (error) throw error;

    return {
      step: "code",
      phone: parsed.data,
      invited: {
        businessName: data.businessName,
        role: data.role,
        name: data.name,
      },
      leavingBusiness: data.leavingBusiness,
      note: data.note,
      devCode: MOCKING ? data.devCode : undefined,
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { step: "phone", message: "No signal. Try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 429) {
        return {
          step: "phone",
          message: "Too many attempts. Wait a minute and try again.",
        };
      }
      /*
        404 is "that number was not invited" and it is the end of the road on
        this screen — there is nothing to retry, and retrying is what somebody
        does when a message sounds temporary. The API's own sentence names the
        business and what to do, so it is shown as it came.
      */
      if (err.isNotFound) {
        return {
          step: "phone",
          message:
            err.message ||
            "That number has not been invited to this business. Ask whoever sent you the link to add it.",
        };
      }
      if (err.status === 400 && err.message) {
        return { step: "phone", message: err.message };
      }
    }
    return { step: "phone", message: "We could not do that just now." };
  }
}

/**
 * Accept, and — only if they have said so — leave the other business.
 *
 * `confirmLeaving` is read from the FORM, not from anything this action
 * carries between renders: the field exists only while a ticked box is on
 * screen beside the name of the business being left. It is never derived from
 * `leavingBusiness` being present, because that field means "ask", not
 * "assume", and it is never inherited from a previous state that a re-render
 * could have left behind.
 */
export async function acceptJoin(
  token: string,
  prev: JoinState,
  form: FormData,
): Promise<JoinState> {
  const phone = prev.phone ?? "";
  if (!phone) return { step: "phone", message: "Start again." };

  const parsed = codeSchema.safeParse(String(form.get("code") ?? ""));
  if (!parsed.success) {
    return { ...prev, step: "code", message: parsed.error.issues[0].message };
  }

  try {
    const { error } = await operatorApi().POST("/join/{token}/accept", {
      params: { path: { token } },
      body: {
        phone,
        code: parsed.data,
        ...(form.get("confirmLeaving") === "yes"
          ? { confirmLeaving: true }
          : {}),
      },
    });
    if (error) throw error;
    return { ...prev, step: "done" };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { ...prev, step: "code", message: "No signal. Nothing changed." };
    }
    if (err instanceof OperatorApiError) {
      /*
        The one that is not a failure. They are in another business and have
        not agreed to leave it — which the code step usually warns about, but
        this is the authoritative answer and the screen must handle it even
        when the warning did not appear.
      */
      if (err.status === 409) {
        /*
          The authoritative "ask them first". The code step usually warns
          already, via `leavingBusiness` — but that warning is advisory and
          this is the server's own refusal, so the screen must be able to raise
          the question from here even when no warning appeared.

          No message: the panel that appears IS the message, and a red line
          above it would read as an error when nothing has gone wrong.
        */
        return {
          ...prev,
          step: "code",
          leavingBusiness: prev.leavingBusiness ?? "another business",
          message: undefined,
        };
      }
      if (err.status === 429) {
        return {
          ...prev,
          step: "code",
          message: "Too many attempts. Wait a minute, then try the code again.",
        };
      }
      if (err.isNotFound) {
        return {
          ...prev,
          step: "phone",
          message:
            err.message || "That number has not been invited to this business.",
        };
      }
      if (err.status === 400 && err.message) {
        return { ...prev, step: "code", message: err.message };
      }
    }
    return {
      ...prev,
      step: "code",
      message: "That did not work. Try the code again.",
    };
  }
}
