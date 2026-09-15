"use server";

import { revalidatePath } from "next/cache";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { suspendedMessage } from "@/lib/account/suspended";
import { describeBlockers } from "@/lib/services/listings";
import { dedash } from "@/lib/format/dedash";

/**
 * Sending a listing for review — yuvoy-operator#58 item 4.
 *
 * One endpoint for both buttons. "Send for review" on a draft and "Send again"
 * on one a reviewer sent back are the same act: the listing goes to somebody at
 * Yuvoy. Two labels, because the operator's situation is different and the
 * second one has already been turned down once.
 */
export interface SubmitState {
  message?: string;
  /** Which step of the builder to open, when the refusal names missing fields. */
  missing?: string[];
  done?: boolean;
}

export async function submitListing(
  _prev: SubmitState,
  form: FormData,
): Promise<SubmitState> {
  const id = String(form.get("experienceId") ?? "");
  if (!id) return { message: "Nothing to send." };

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).POST(
      "/experiences/{id}/submit",
      { params: { path: { id } } },
    );
    if (error) throw error;

    revalidatePath(`/account/listings/${id}`);
    revalidatePath("/account");
    return { done: true };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. It was not sent. Try again." };
    }
    if (err instanceof OperatorApiError) {
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 409) {
        /*
          "A double tap is safe: an `in_review` listing answers `200`." So a 409
          here is a listing that is no longer a draft at all — published, or
          withdrawn — and the way forward is the listing screen rather than
          another tap.
        */
        return { message: "This listing is no longer a draft." };
      }
      if (err.status === 400) {
        const details = err.details as { missing?: string[] } | undefined;
        const missing = details?.missing;
        if (missing && missing.length > 0) {
          return {
            message: `Still missing: ${describeBlockers(missing).join(", ")}`,
            missing,
          };
        }
        /*
          A `400` with no `details` is the one refusal the API does not itemise,
          and the contract names it: the destination is outside the market this
          operator sells in. Said plainly, with where to fix it.
        */
        return {
          message:
            "The destination is outside your market. Choose another in Edit.",
        };
      }
      if (err.isNotFound) {
        return { message: "That listing is no longer on your account." };
      }
      if (err.status === 403) {
        return {
          message:
            "Only owners, admins and managers can send a listing for review.",
        };
      }
    }
    return { message: dedash("It was not sent. Try again.") };
  }
}
