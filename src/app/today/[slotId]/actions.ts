"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";

/**
 * O10's one write: ticking somebody off, or saying how it ended.
 *
 * A Server Action rather than a route handler. There is no generic proxy in
 * this repo — see lib/api/server-client.ts — so this is the entire surface the
 * browser can reach for attendance: one action, one booking id, one of three
 * outcomes, with the session read server-side from an httpOnly cookie the page
 * cannot see.
 */

export interface AttendanceState {
  /** Set only when something went wrong. Success re-renders the manifest. */
  message?: string;
  /** Which row failed, so the error lands on the right person. */
  bookingId?: string;
}

const schema = z.object({
  bookingId: z.string().min(1),
  slotId: z.string().min(1),
  outcome: z.enum(["arrived", "completed", "no_show"]),
});

export async function markAttendance(
  _prev: AttendanceState,
  form: FormData,
): Promise<AttendanceState> {
  const parsed = schema.safeParse({
    bookingId: form.get("bookingId"),
    slotId: form.get("slotId"),
    outcome: form.get("outcome"),
  });

  if (!parsed.success) {
    /*
      A party still holding has no bookingId, so it lands here rather than at
      the API. That is the right place for it: there is nothing to record
      against a hold, and the row renders without these buttons anyway.
    */
    return { message: "That party cannot be marked yet." };
  }

  const { bookingId, slotId, outcome } = parsed.data;
  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).POST(
      "/bookings/{id}/attendance",
      { params: { path: { id: bookingId } }, body: { outcome } },
    );
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { bookingId, message: "No signal. Nothing was recorded." };
    }
    if (err instanceof OperatorApiError) {
      /*
        409 is two different real situations and the operator needs to know
        which. `departure_has_not_started` means wait; `not_on_this_departure`
        means this person is already settled, cancelled or declined — the API
        refuses to overwrite a settled booking rather than silently changing
        it, "because an operator who marks a no-show as completed by mistake
        needs to see that".
      */
      if (err.code === "departure_has_not_started") {
        return {
          bookingId,
          message: "Wait until the trip has set off to close it out.",
        };
      }
      if (err.code === "not_on_this_departure") {
        return {
          bookingId,
          message: "Already settled. Refresh to see where it landed.",
        };
      }
      if (err.isNotFound) {
        // 404 covers "gone" and "not yours" identically, by design. Rendering
        // two messages here would rebuild the oracle the server refuses to be.
        return { bookingId, message: "That booking is not on this departure." };
      }
    }
    return { bookingId, message: "Not recorded. Try again." };
  }

  // The manifest is the source of truth, so it is re-read rather than patched
  // locally. Totals are computed server-side precisely so three clients cannot
  // disagree about them on a dock.
  revalidatePath(`/today/${slotId}`);
  return {};
}
