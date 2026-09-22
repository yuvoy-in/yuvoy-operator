"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import {
  CALL_OFF_REASONS,
  NOTE_MAX,
  RELAY_INTENTS,
  validateRelay,
  type CallOffReason,
  type RelayIntent,
} from "@/lib/day/relay-types";
import { suspendedMessage } from "@/lib/account/suspended";
import { dedash } from "@/lib/format/dedash";
import { toGiveBack, type GiveBack } from "@/lib/money/give-back";

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

/* ------------------------------------------------------------------ relay */

export interface RelayState {
  message?: string;
  /**
   * Set on success: how many PEOPLE a message is going to. It counts queued
   * messages, never bookings, since yuvoy-api#200 (op#89): a person we hold no
   * reachable address for is not somebody who was told.
   */
  recipients?: number;
  /** The same number by channel, e.g. `{ email: 3 }`. */
  byChannel?: Record<string, number>;
  /** People on it nothing could carry the message to. Only when above zero. */
  notReached?: number;
  /** The API's sentence for them, "safe to show the operator verbatim". */
  notReachedNote?: string;
  intent?: string;
}

const relaySchema = z.object({
  slotId: z.string().min(1),
  /** Empty means the whole departure. */
  bookingId: z.string(),
  intent: z.enum(
    RELAY_INTENTS.map((i) => i.intent) as [RelayIntent, ...RelayIntent[]],
  ),
  detail: z.string(),
  note: z.string().max(NOTE_MAX),
});

/**
 * Tell one traveller, or a whole departure.
 *
 * The operator never sees a phone number and never writes a message: they pick
 * a structured intent and supply exactly one fact, which is the only
 * operator-written value that reaches a phone (O12).
 *
 * `note` is the exception and the trap. It is shown on the traveller's status
 * page and **never sent to a phone**, so the UI has to say so — an operator
 * who thinks they messaged somebody and did not is worse than one who knows
 * they left a note.
 */
export async function sendRelay(
  _prev: RelayState,
  form: FormData,
): Promise<RelayState> {
  const parsed = relaySchema.safeParse({
    slotId: form.get("slotId"),
    bookingId: form.get("bookingId") ?? "",
    intent: form.get("intent"),
    detail: form.get("detail") ?? "",
    note: form.get("note") ?? "",
  });
  if (!parsed.success) {
    return { message: "Pick what you are telling them." };
  }

  const { slotId, bookingId, intent, detail, note } = parsed.data;

  // The same rules the API applies, so an operator on a jetty does not read a
  // 400 they cannot act on. The API remains the authority.
  const problem = validateRelay(intent, detail, note);
  if (problem) return { message: problem.message };

  const { token } = await requireOperator();
  const body = {
    intent,
    ...(detail.trim() ? { detail: detail.trim() } : {}),
    ...(note.trim() ? { note: note.trim() } : {}),
  };

  try {
    const api = operatorApi(token);
    const { data, error } = bookingId
      ? await api.POST("/bookings/{id}/relay", {
          params: { path: { id: bookingId } },
          body,
        })
      : await api.POST("/slots/{id}/relay", {
          params: { path: { id: slotId } },
          body,
        });
    if (error) throw error;

    /*
      The recipient count is shown back rather than swallowed. "Sent" is not an
      outcome an operator can check, and a relay that reached nobody looks
      identical to one that reached eleven people unless the number is on
      screen.

      Every new field is optional here whatever the contract says, and each
      one's absence reads as the old answer: no split, and nobody unreached.
    */
    const notReached =
      Number.isInteger(data.notReached) && (data.notReached ?? 0) > 0
        ? (data.notReached as number)
        : 0;
    revalidatePath(`/today/${slotId}`);
    return {
      intent,
      recipients: data.recipients ?? 0,
      ...(data.byChannel ? { byChannel: data.byChannel } : {}),
      ...(notReached > 0
        ? {
            notReached,
            ...(data.notReachedNote
              ? { notReachedNote: dedash(data.notReachedNote) }
              : {}),
          }
        : {}),
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was sent." };
    }
    if (err instanceof OperatorApiError) {
      /*
        Two refusals that used to read "Not sent. Try again." (op#90 f13), and
        neither is fixed by trying again. `nobody_to_tell` is a departure or a
        booking with no live booking left on it, which a retry cannot change;
        `too_many_updates` is the hourly limit, which only waiting clears.
      */
      if (err.code === "nobody_to_tell") {
        return {
          message: bookingId
            ? "This booking is no longer live, so there is nobody to tell. Nothing was sent."
            : "Nobody on this departure has a live booking, so there is nobody to tell. Nothing was sent.",
        };
      }
      if (err.code === "too_many_updates" || err.status === 429) {
        return {
          message:
            "That is the most updates you can send in an hour. This one was not sent. Try again later.",
        };
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        return { message: "Your role cannot message travellers." };
      }
      if (err.isNotFound) {
        return { message: "That departure is no longer here." };
      }
      if (err.status === 400) {
        // The API rejected the fact itself — usually the character rule.
        return { message: err.message };
      }
    }
    return { message: "Not sent. Try again." };
  }
}

/* --------------------------------------------------------------- call off */

export interface CallOffState {
  message?: string;
  /** What it actually did. Shown back — see below. */
  result?: {
    bookingsCancelled: number;
    guestsAffected: number;
    /** Everything captured ONLINE. A cash booking adds nothing here. */
    refundedPaise: number;
    holdsReleased: number;
    /**
     * Cash the business took from travellers now cancelled, which nothing
     * refunds because it never reached us (op#95). `null` when there is none,
     * the ordinary case.
     */
    giveBack: GiveBack | null;
  };
}

const callOffSchema = z.object({
  slotId: z.string().min(1),
  reasonCode: z.enum(
    CALL_OFF_REASONS.map((r) => r.code) as [CallOffReason, ...CallOffReason[]],
  ),
  note: z.string().max(500),
  /*
    Not a boolean. The contract is explicit: "a checkbox is one mis-tap on a
    wet phone away from cancelling a full boat, and this is the only action in
    the portal that cannot be undone." The operator types the departure's own
    id back.
  */
  confirmSlotId: z.string().min(1),
});

/**
 * This departure cannot run.
 *
 * Cancels the departure, cancels every booking on it, refunds everything paid
 * ONLINE in full, releases the holds and messages everyone booked, in one
 * transaction. Full refunds regardless of the cancellation policy: those tiers
 * price a traveller changing their mind, and nobody changed their mind here.
 *
 * Cash is the exception, and the result says so: a traveller who paid at the
 * counter paid nothing online, so nothing is refunded to them and the
 * business is holding their money. `cashToGiveBack` names each of them.
 *
 * The only irreversible action in the portal.
 */
export async function callOffDeparture(
  _prev: CallOffState,
  form: FormData,
): Promise<CallOffState> {
  const parsed = callOffSchema.safeParse({
    slotId: form.get("slotId"),
    reasonCode: form.get("reasonCode"),
    note: form.get("note") ?? "",
    confirmSlotId: form.get("confirmSlotId") ?? "",
  });
  if (!parsed.success) {
    return { message: "Pick a reason and confirm the departure id." };
  }

  const { slotId, reasonCode, note, confirmSlotId } = parsed.data;

  // Checked here before the round trip, and again by the API. A mis-typed
  // confirmation should not cost a request, and it must never be skipped.
  if (confirmSlotId.trim() !== slotId) {
    return {
      message:
        "That is not this departure's id. Nothing was cancelled. Check it and try again.",
    };
  }

  /*
    Role, re-read at the moment of the tap. The panel is not rendered for
    STAFF, but a Server Action is a public POST endpoint, and this is the one
    action in the portal that cannot be undone. The contract's 403 stays
    handled below it.
  */
  const { token, me } = await requireOperator();
  if (!me.canManage) {
    return {
      message:
        "Calling off a departure needs an owner, an admin or a manager. Nothing was cancelled.",
    };
  }

  try {
    const { data, error } = await operatorApi(token).POST(
      "/slots/{id}/call-off",
      {
        params: { path: { id: slotId } },
        body: {
          reasonCode,
          confirmSlotId: confirmSlotId.trim(),
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      },
    );
    if (error) throw error;

    revalidatePath(`/today/${slotId}`);
    revalidatePath("/today");
    return {
      result: {
        bookingsCancelled: data.bookingsCancelled ?? 0,
        guestsAffected: data.guestsAffected ?? 0,
        refundedPaise: data.refundedPaise ?? 0,
        holdsReleased: data.holdsReleased ?? 0,
        giveBack: toGiveBack(data.cashToGiveBack),
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was cancelled." };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "already_called_off") {
        /*
          Not "everybody on it has been told": that is not the call-off's to
          promise, since a message only reaches people we can reach.
        */
        return { message: "This departure is already called off." };
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        // STAFF cannot call off a departure.
        return {
          message:
            "Your role cannot call off a departure. An owner, admin or manager has to.",
        };
      }
      if (err.isNotFound)
        return { message: "That departure is no longer here." };
      if (err.status === 400) return { message: err.message };
    }
    return { message: "Not cancelled. Try again." };
  }
}
