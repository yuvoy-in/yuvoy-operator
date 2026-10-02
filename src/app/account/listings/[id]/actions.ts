"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { suspendedMessage } from "@/lib/account/suspended";
import { describeBlockers } from "@/lib/services/listings";
import { dedash } from "@/lib/format/dedash";
import { sentence } from "@/lib/format/sentence";

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

/**
 * Discarding a draft nobody has seen (yuvoy-operator#112).
 *
 * A listing is created the moment step one is saved, so an operator who
 * started one and changed their mind, or was only trying the portal, was left
 * with a draft that could never be published and never removed.
 * `DELETE /experiences/{id}` is that way back: `204` and it is gone, `409` once
 * it has ever been sent to us, `404` for one that is not on this account.
 *
 * ## Success goes to Business, and nothing else counts as success
 *
 * There is nothing left to show here, so the receipt is the listings without
 * its tile: `/account` re-reads and the operator lands on it. Every refusal
 * keeps them on the draft, which is still there, and says so. A `409` or a
 * `404` is said in the API's own words: either one means this screen is out of
 * date, and the API knows why.
 *
 * ## An API from before yuvoy-api#249 (merged is not deployed)
 *
 * The route did not exist, so the method is refused: `405`. That is read as
 * "not available yet", never as done. Delete the branch once production is
 * confirmed on #249 or later.
 */
export interface DiscardState {
  message?: string;
}

const ROLE_REFUSAL = "Only owners, admins and managers can discard a draft.";

export async function discardDraft(
  _prev: DiscardState,
  form: FormData,
): Promise<DiscardState> {
  const id = String(form.get("experienceId") ?? "");
  if (!id) return { message: "There is no draft to discard." };

  /*
    The page draws this only for a role that can manage, and roles change
    between a render and a tap: `GET /me` is re-read on every action. The
    API's own `403` stays handled below, for the day the two disagree.
  */
  const { token, me } = await requireOperator();
  if (!me.canManage) return { message: ROLE_REFUSAL };

  try {
    const { error } = await operatorApi(token).DELETE("/experiences/{id}", {
      params: { path: { id } },
    });
    if (error) throw error;
  } catch (err) {
    return discardFailure(err);
  }

  revalidatePath("/account");
  redirect("/account");
}

function discardFailure(err: unknown): DiscardState {
  if (err instanceof OperatorNetworkError) {
    return { message: "No signal. The draft is still here. Try again." };
  }
  if (err instanceof OperatorApiError) {
    const refusal = suspendedMessage(err);
    if (refusal) return { message: refusal };
    if (err.status === 405) {
      return {
        message: "Discarding a draft is not available yet. It is still here.",
      };
    }
    if (err.status === 409 || err.isNotFound) {
      return { message: sentence(err.message) };
    }
    if (err.status === 403) return { message: ROLE_REFUSAL };
  }
  return { message: "The draft is still here. Try again." };
}
