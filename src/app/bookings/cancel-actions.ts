"use server";

import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { CALL_OFF_REASONS, type CallOffReason } from "@/lib/day/relay-types";
import { suspendedMessage } from "@/lib/account/suspended";

/**
 * Cancelling one booking, and recording that its cash went back — #43 items 4
 * and 5.
 *
 * ## Both are one-way, and they are one-way in different ways
 *
 * Cancelling "refunds in full whatever the traveller paid online and frees
 * their seats, in one transaction", and a retry answers `409 already_cancelled`
 * rather than refunding twice. Recording the cash back "cannot be undone, and
 * it is recorded once".
 *
 * So neither is a button: cancelling asks for the reference typed back, because
 * "this cannot be undone, and a checkbox is one mis-tap away from the wrong
 * party", and the cash one asks for a second tap.
 *
 * ## Both stay available while the business is suspended
 *
 * Deliberately (#50). A suspended business must still be able to tell a
 * traveller their trip is off and hand back money it is holding, and refusing
 * that would strand the traveller rather than the operator.
 */

/** The reason list, derived rather than retyped, so the form cannot drift. */
const cancelSchema = z.object({
  bookingId: z.string().min(1),
  reasonCode: z.enum(
    CALL_OFF_REASONS.map((r) => r.code) as [CallOffReason, ...CallOffReason[]],
  ),
  /*
    500 is the contract's own limit and it is checked here as well as there.
    Not to save a round trip: a note over the limit is refused with nothing
    cancelled, and the operator has by then typed a reference and chosen a
    reason. Failing on the length before any of that is sent is kinder than
    failing after.
  */
  note: z.string().trim().max(500, "That note is longer than 500 characters."),
  confirmReference: z.string().trim().min(1),
});

export interface CancelState {
  message?: string;
  /** Which field the message belongs to, so the form can point at it. */
  field?: "reasonCode" | "note" | "confirmReference";
  /** Set when it worked, so the screen can say what it cost. */
  done?: {
    refundedPaise: number;
    seatsReleased: number;
    /** The API's own sentence about cash the business is holding. */
    note?: string;
  };
  /**
   * The booking is already cancelled, by this tap or by somebody else's.
   *
   * Distinct from `done` because there is nothing to report: nothing was
   * refunded a second time, and "it is cancelled" is the whole answer. The
   * screen reloads rather than printing a failure, which is what the issue asks
   * for: "pressing again after it worked shows the booking as cancelled, not an
   * error."
   */
  alreadyCancelled?: boolean;
}

export async function cancelBooking(
  _prev: CancelState,
  form: FormData,
): Promise<CancelState> {
  const parsed = cancelSchema.safeParse({
    bookingId: String(form.get("bookingId") ?? ""),
    reasonCode: String(form.get("reasonCode") ?? ""),
    note: String(form.get("note") ?? ""),
    confirmReference: String(form.get("confirmReference") ?? ""),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue.path[0] ?? "");
    return {
      field: field === "note" ? "note" : "reasonCode",
      message: field === "note" ? issue.message : "Choose why they cannot go.",
    };
  }

  const { token } = await requireOperator();
  const { bookingId, reasonCode, note, confirmReference } = parsed.data;

  try {
    const { data, error } = await operatorApi(token).POST(
      "/bookings/{id}/cancel",
      {
        params: { path: { id: bookingId } },
        body: {
          reasonCode,
          /*
            Omitted when empty rather than sent as "". An empty note is an
            absence, and storing one puts a blank line on the record of a
            cancellation where somebody will later look for a reason.
          */
          ...(note ? { note } : {}),
          confirmReference,
        },
      },
    );
    if (error) throw error;

    /*
      NOT revalidated, and this is the case the repo's rule was written for:
      revalidate only when the re-render shows MORE than the returned value.

      Here it shows less, and it takes the more with it. `refundedPaise`,
      `seatsReleased` and the cash note are on the response and nowhere else,
      and a re-render makes the booking uncancellable — which unmounts the very
      component holding them. The first build of this did revalidate, and the
      e2e caught it: the booking came back correctly cancelled and the operator
      was never told what it refunded.

      Every route that lists this booking is `force-dynamic`, so nothing is
      cached to go stale; the screen behind the panel catches up on the
      operator's own tap, which is `router.refresh()` in `CancelBooking`.
    */
    return {
      done: {
        refundedPaise: data.refundedPaise,
        seatsReleased: data.seatsReleased,
        ...(data.note ? { note: data.note } : {}),
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return {
        message:
          "No signal. Nothing was cancelled and nothing was refunded. Try again.",
      };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "already_cancelled") {
        /*
          Not a failure. "Retrying after it worked answers `409
          already_cancelled` and refunds nothing twice" — which is exactly what
          a lost response on one bar of signal looks like, so it is reported as
          the outcome rather than as an error.
        */
        return { alreadyCancelled: true };
      }
      if (err.code === "confirmation_required") {
        return {
          field: "confirmReference",
          message: "That is not this booking's reference.",
        };
      }
      if (err.code === "invalid_reason_code") {
        return { field: "reasonCode", message: err.message };
      }
      // A suspended business is refused with 403 too, and the role sentence
      // would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        return {
          message: "Only owners, admins and managers can cancel a booking.",
        };
      }
      if (err.status === 400) {
        // A note over 500 characters lands here, and the server's sentence says
        // so more precisely than a guess would.
        return { field: "note", message: err.message };
      }
      if (
        err.code === "booking_ended" ||
        err.code === "departure_started" ||
        err.code === "refund_already_raised"
      ) {
        /*
          Three different things and three different next steps, and the API
          writes each of them: it was declined or completed, the boat has left,
          or part of it is already refunded so "ask us to cancel it". A single
          sentence of ours would lose the only actionable one.
        */
        return { message: err.message };
      }
      if (err.isNotFound) {
        return { message: "That booking is not on your account any more." };
      }
    }
    return { message: "Nothing was cancelled. Try again." };
  }
}

export interface CashBackState {
  message?: string;
  done?: { returnedPaise: number; returnedAt: string };
  /** It was already recorded. Not a failure; the screen reloads. */
  alreadyReturned?: boolean;
}

/**
 * Record that the cash went back to the traveller.
 *
 * Nothing to send. "We refund nothing on a booking paid in cash, because that
 * money never reached us, so it is yours to give back" — this records that the
 * business did, and the record is what an operator can point at later.
 */
export async function recordCashReturned(
  _prev: CashBackState,
  form: FormData,
): Promise<CashBackState> {
  const bookingId = String(form.get("bookingId") ?? "");
  if (!bookingId) return { message: "Nothing to record." };

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/bookings/{id}/cash-returned",
      { params: { path: { id: bookingId } } },
    );
    if (error) throw error;

    // Not revalidated, for the reason `cancelBooking` gives above: re-rendering
    // removes the control and the panel reporting what went back with it.
    return {
      done: { returnedPaise: data.returnedPaise, returnedAt: data.returnedAt },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return {
        message: "No signal. Nothing was recorded. Try again.",
      };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "cash_already_returned") {
        /*
          "A retry answers `409 cash_already_returned` and changes nothing."
          Reported as the outcome, with a reload, because a second tap on one
          bar of signal is the common way to arrive here.
        */
        return { alreadyReturned: true };
      }
      if (err.code === "nothing_to_give_back") {
        /*
          Three cases behind one code — not cancelled, paid online, no cash
          recorded — and "the message says which". Rendered, then the booking is
          reloaded, because every one of the three means the screen is out of
          date about this booking.
        */
        return { message: err.message };
      }
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        return {
          message:
            "Only owners, admins and managers can record giving the cash back.",
        };
      }
      if (err.isNotFound) {
        return { message: "That booking is not on your account any more." };
      }
    }
    return { message: "Nothing was recorded. Try again." };
  }
}
