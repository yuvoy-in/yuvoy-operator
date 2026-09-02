"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { DECLINE_REASONS, type DeclineReason } from "@/lib/day/request-types";

/**
 * Answering a request — the two writes on O9.
 *
 * Both are time-critical in a way nothing else in the portal is: a traveller
 * is waiting on the other end of every row, and a request that expires
 * unanswered is a traveller told no by a clock. So every failure here says
 * what actually happened rather than "try again", because the operator needs
 * to know whether to answer a different way, right now.
 */

export interface RequestActionState {
  /** Set only on failure. Success re-renders the queue. */
  message?: string;
  requestId?: string;
  /** A granted hold's deadline, so the screen can say what the traveller now has. */
  holdExpiresAt?: string | null;
  granted?: boolean;
}

const acceptSchema = z.object({ requestId: z.string().min(1) });

/**
 * Said here, and said by the API. `GET /me` is re-read on every action, so
 * this is the role at the moment of the tap rather than the one the page was
 * rendered with — and it is the first line, not the only one: the contract's
 * own 403 is rendered with the same words below, for the day the two disagree.
 * A disabled button is a courtesy; a Server Action is a public POST endpoint.
 */
const ROLE_REFUSAL =
  "Your role cannot answer requests. An owner or manager has to.";

/*
  The enum is derived from DECLINE_REASONS rather than retyped, so the form,
  the validator and the request body cannot disagree about the closed set the
  contract defines. `as const` on the list is what keeps the literal union.
*/
const declineSchema = z.object({
  requestId: z.string().min(1),
  reasonCode: z.enum(
    DECLINE_REASONS.map((r) => r.code) as [DeclineReason, ...DeclineReason[]],
  ),
});

/** Maps the contract's refusals onto something an operator can act on. */
function explain(err: unknown, verb: string): string {
  if (err instanceof OperatorNetworkError) {
    return "No signal. Nothing was sent — the request is still open.";
  }
  if (err instanceof OperatorApiError) {
    if (err.code === "request_not_open") {
      // Already answered, or out of time. Both mean: stop, and look again.
      return "Already answered, or out of time. Refresh to see the queue.";
    }
    if (err.code === "grant_ceiling_exceeded") {
      return "That would put more people on the boat than it holds. Nothing was granted.";
    }
    if (err.status === 403) {
      // The contract is specific: STAFF may not commit seats.
      return ROLE_REFUSAL;
    }
    if (err.isNotFound) {
      return "That request is no longer here.";
    }
  }
  return `Could not ${verb}. Nothing was sent.`;
}

export async function acceptRequest(
  _prev: RequestActionState,
  form: FormData,
): Promise<RequestActionState> {
  const parsed = acceptSchema.safeParse({ requestId: form.get("requestId") });
  if (!parsed.success) return { message: "That request cannot be answered." };

  const { requestId } = parsed.data;
  const { token, me } = await requireOperator();
  if (!me.canManage) return { requestId, message: ROLE_REFUSAL };

  try {
    const { data, error } = await operatorApi(token).POST(
      "/requests/{id}/accept",
      { params: { path: { id: requestId } } },
    );
    if (error) throw error;

    /*
      The hold deadline is shown back rather than swallowed. Accepting does not
      end this: the traveller now holds seats with a clock on them and must pay
      before it lapses, exactly like a direct-booking traveller at checkout.
      An operator who thinks "accepted" means "booked" will not chase it.

      **Deliberately no `revalidatePath` here, unlike the decline below.**

      Revalidating re-renders the queue, and an accepted request has left it —
      so the row unmounts and takes the confirmation with it. The operator taps
      Accept and the row simply vanishes, with nothing anywhere saying the
      traveller still has to pay. That is the exact misunderstanding this
      screen exists to prevent, produced by the cache call meant to keep it
      fresh.

      Not revalidating is necessary and was not sufficient. `RefreshOnFocus`
      calls `router.refresh()` on every focus and every minute, which re-runs
      the server render — and the accepted request has left the queue, so its
      row unmounted and took the receipt with it anyway. The operator tapped
      Accept, flipped to WhatsApp to tell the traveller to pay, flipped back,
      and nothing said "still have to pay". So the receipt is held ABOVE the
      list, in `RequestQueue`, where a refresh cannot reach it: the queue
      reconciles underneath, the receipt stays until a real navigation. The
      page is force-dynamic and no-store, so nothing stale survives one.
    */
    return { granted: true, holdExpiresAt: data.holdExpiresAt ?? null };
  } catch (err) {
    return { requestId, message: explain(err, "accept") };
  }
}

export async function declineRequest(
  _prev: RequestActionState,
  form: FormData,
): Promise<RequestActionState> {
  const parsed = declineSchema.safeParse({
    requestId: form.get("requestId"),
    reasonCode: form.get("reasonCode"),
  });
  if (!parsed.success) {
    // The reason is a closed set in the contract; an unknown one is a bug here
    // rather than something to forward and have refused.
    return { message: "Pick a reason before declining." };
  }

  const { requestId, reasonCode } = parsed.data;
  const { token, me } = await requireOperator();
  if (!me.canManage) return { requestId, message: ROLE_REFUSAL };

  try {
    const { error } = await operatorApi(token).POST("/requests/{id}/decline", {
      params: { path: { id: requestId } },
      body: { reasonCode },
    });
    if (error) throw error;

    /*
      Declining DOES revalidate: there is no post-state to show. The request is
      gone and the row going with it is the honest rendering — unlike an
      accept, where something new exists that the operator has to know about.
    */
    revalidatePath("/requests");
    return {};
  } catch (err) {
    return { requestId, message: explain(err, "decline") };
  }
}
