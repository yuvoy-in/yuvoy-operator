"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { bankProblem } from "@/lib/account/bank";
import { suspendedMessage } from "@/lib/account/suspended";
import { SESSION_ENDED, stepUpRefusal } from "@/lib/account/step-up";

/**
 * O4's three writes: ask for a code, use it, change the account — plus the
 * emergency brake.
 *
 * The ordering of gates is the security model, so it is worth restating where
 * it is enforced: OWNER only and a code to an OWNER are both the server's job,
 * and this file surfaces those refusals rather than second-guessing them. What
 * it does locally is refuse a malformed account number, so a typo does not
 * cost a code, a message to the owner and a 24-hour clock.
 */

const MOCKING = process.env.NEXT_PUBLIC_API_MOCKING === "enabled";

export interface StepUpState {
  sent?: boolean;
  message?: string;
  /** Development only, exactly as on sign-in. Never reaches production. */
  devCode?: string;
  /**
   * The API accepted the request and sent nothing — `202` with `sent: false`.
   *
   * Two reasons, and the response does not say which. A business whose first
   * person runs it has no owner (D15), so "the code goes to no number". And
   * since yuvoy-api 67e3213 `sent` is read back from the queued message: the
   * step-up code goes to an owner by email while there is no WhatsApp sender,
   * so an owner with no email on their account is an owner nothing can reach
   * either (yuvoy-operator#91). Distinct from `message`, because nothing went
   * wrong and there is nothing to retry; the sentence names both causes.
   */
  nobodyToSendTo?: boolean;
}

/**
 * Send a code to an OWNER.
 *
 * "The code goes to the OWNER's number whoever asks — a compromised MANAGER
 * login must not be able to both request the elevation and receive the code
 * that grants it." The screen says whose it is for that reason: a manager who
 * asked and did not receive it has learned something true. It travels by email
 * since yuvoy-api 67e3213, to the owner's address, never the asker's.
 *
 * Each refusal the endpoint declares has its own sentence (yuvoy-operator#90):
 * `401` is a session that has ended, `403 account_suspended` is the business,
 * and `429` is wait.
 */
export async function requestStepUp(): Promise<StepUpState> {
  const { token } = await requireOperator();
  try {
    const { data, error } = await operatorApi(token).POST("/auth/step-up", {});
    if (error) throw error;

    /*
      `data.sent` is READ. This returned `sent: true` whatever the API said,
      which put a code field in front of somebody at a business with no owner
      and left them typing into it (yuvoy-operator#46 item 4).

      It is `false` when nothing can carry the code, which is not an error: no
      owner to send it to, or an owner with no email while there is no phone
      sender. Absent is read as `true`, because that is what every response
      before this field existed meant.
    */
    if (data.sent === false) {
      return { sent: false, nobodyToSendTo: true };
    }
    return { sent: true, devCode: MOCKING ? data.devCode : undefined };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. No code was sent." };
    }
    if (err instanceof OperatorApiError) {
      /*
        A suspended business cannot raise a bank change, and the API's own
        sentence says which of suspended, closed or disqualified it is (#50). A
        generic "we could not send a code" would have them trying again.
      */
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 429) {
        return { message: "Too many attempts. Wait a minute." };
      }
      if (err.isUnauthorized) return { message: SESSION_ENDED };
    }
    return { message: "We could not send a code just now." };
  }
}

export interface BankState {
  message?: string;
  field?: string;
  /** Set when the change was raised. */
  raised?: {
    summary: string;
    objectionUntil?: string;
    whatHappensNext?: string;
  };
  /** The server refused because the session is not elevated. */
  needsStepUp?: boolean;
}

const bankSchema = z.object({
  code: z.string().trim(),
  accountHolder: z.string(),
  accountNumber: z.string(),
  ifsc: z.string(),
  bankName: z.string(),
});

/**
 * Change where the money goes.
 *
 * Verifies the step-up code and raises the change in one submit, because they
 * are one decision from the operator's side — asking them to press two buttons
 * ten minutes apart is how a session times out mid-form.
 */
export async function changeBank(
  _prev: BankState,
  form: FormData,
): Promise<BankState> {
  const parsed = bankSchema.safeParse({
    code: form.get("code") ?? "",
    accountHolder: form.get("accountHolder") ?? "",
    accountNumber: form.get("accountNumber") ?? "",
    ifsc: form.get("ifsc") ?? "",
    bankName: form.get("bankName") ?? "",
  });
  if (!parsed.success) return { message: "Fill in the account details." };

  const { code, ...bank } = parsed.data;

  // Refused here first: a typo must not cost a code, a message to the owner
  // and a 24-hour clock.
  const problem = bankProblem(bank);
  if (problem) return { field: problem.field, message: problem.message };

  if (!/^\d{4,8}$/.test(code)) {
    return {
      field: "code",
      message: "Enter the code that went to the owner.",
    };
  }

  const { token } = await requireOperator();
  const api = operatorApi(token);

  try {
    const { error } = await api.POST("/auth/step-up/verify", {
      body: { code },
    });
    if (error) throw error;
  } catch (err) {
    // One sentence per declared refusal, suspension first. See `stepUpRefusal`.
    return stepUpRefusal(err);
  }

  try {
    const { data, error } = await api.POST("/change-requests/bank", {
      body: {
        accountHolder: bank.accountHolder.trim(),
        accountNumber: bank.accountNumber.replace(/\s/g, ""),
        ifsc: bank.ifsc.trim().toUpperCase(),
        ...(bank.bankName.trim() ? { bankName: bank.bankName.trim() } : {}),
      },
    });
    if (error) throw error;

    /*
      Revalidate, and let the page's own in-progress panel be the confirmation.
      It shows the masked account, BOTH clocks and the brake — strictly more
      than a "raised" message could, and it is live rather than a snapshot.

      This is the third place in this repo where an action and a
      `revalidatePath` competed to tell the operator what happened, and the
      rule that fell out is worth stating: **revalidate when the re-rendered
      page shows the outcome better, do not when it erases it.** The request
      accept and the change cancel are the two that erase it; this one
      improves on it.
    */
    void data;
    revalidatePath("/payouts");
    revalidatePath("/earnings");
    return {};
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was changed." };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "change_already_in_progress") {
        // One at a time: "two open bank changes would mean the second approval
        // silently decides which account wins."
        return {
          message:
            "There is already a bank change in progress. Stop that one first. Two at once means whichever is approved last silently wins.",
        };
      }
      if (err.code === "step_up_required") {
        return {
          needsStepUp: true,
          message: "Ask for a new code and try again.",
        };
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        return {
          message:
            "Only the owner can change where the money goes. Ask them to do it from their own login.",
        };
      }
      if (err.status === 400) return { message: err.message };
    }
    return { message: "Nothing was changed. Try again." };
  }
}

export interface CancelState {
  message?: string;
  stopped?: boolean;
}

/**
 * The emergency brake.
 *
 * Deliberately **not** behind step-up: "the person most likely to need this is
 * the owner who just received a warning about a change they did not make, and
 * making them pass another code first puts the emergency brake further away
 * than the accelerator."
 */
export async function cancelChange(
  _prev: CancelState,
  form: FormData,
): Promise<CancelState> {
  const id = String(form.get("id") ?? "");
  if (!id) return { message: "Nothing to stop." };

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).POST(
      "/change-requests/{id}/cancel",
      { params: { path: { id } } },
    );
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. It was NOT stopped. Try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "change_already_decided") {
        /*
          Distinguished from 404 on purpose. "We cannot find it" and "it
          already happened" mean very different things to somebody who has just
          realised their account was compromised.
        */
        return {
          message:
            "It has already gone through. This could not be stopped. Call us now on +91 81216 57657.",
        };
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        // OWNER or ADMIN may stop one (D33); raising is the OWNER-only half.
        return {
          message: "Only an owner or an admin can stop a bank change.",
        };
      }
      if (err.isNotFound) {
        return {
          message:
            "That change is no longer here. Refresh to see what happened.",
        };
      }
    }
    return { message: "It was not stopped. Try again." };
  }

  /*
    Deliberately NO `revalidatePath` here, and it is the same reasoning as the
    request accept in O9.

    Revalidating re-renders the page, the change is no longer open, the panel
    unmounts — and the confirmation goes with it. The owner taps "this wasn't
    me", everything vanishes, and nothing anywhere says it worked. On the one
    screen whose whole job is an emergency brake, a brake that gives no
    feedback is a brake somebody presses twice and then telephones about.

    The panel's own stopped state is the truthful thing to show. A navigation
    or refresh re-renders on the server anyway — the page is force-dynamic and
    the change shows as withdrawn in the history.
  */
  return { stopped: true };
}
