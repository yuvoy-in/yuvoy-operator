"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import {
  BLACKOUT_REASONS,
  MAX_SEATS,
  blackoutProblem,
  capacityProblem,
  type BlackoutReason,
} from "@/lib/day/capacity-types";
import { dedash, dedashText } from "@/lib/format/dedash";
import { sentence } from "@/lib/format/sentence";
import { suspendedMessage } from "@/lib/account/suspended";
import { ROLE_REFUSAL } from "./role-refusal";

/**
 * The four capacity writes.
 *
 * All four are OWNER, ADMIN or MANAGER, and all four refuse in ways that matter
 * more than they succeed — which is why every branch here says what actually
 * happened rather than "try again".
 */

export interface CapacityState {
  message?: string;
  seats?: number;
  slotId?: string;
}

const seatsSchema = z.object({
  slotId: z.string().min(1),
  seats: z.coerce.number().int().min(0).max(MAX_SEATS),
  sold: z.coerce.number().int().min(0),
});

/**
 * Change how many seats a departure offers.
 *
 * The refusal is the point. "You cannot reduce a departure below what is
 * already sold. Not 'should not' — the database refuses it, because the
 * alternative is a traveller with a paid booking and no seat, discovered at a
 * jetty at six in the morning."
 *
 * A 409 body is rendered **verbatim**, because the contract asks clients to:
 * it "returns copy telling the operator what to do instead", and replacing
 * that with a generic error throws away the only useful part.
 */
export async function setCapacity(
  _prev: CapacityState,
  form: FormData,
): Promise<CapacityState> {
  const parsed = seatsSchema.safeParse({
    slotId: form.get("slotId"),
    seats: form.get("seats"),
    sold: form.get("sold"),
  });
  if (!parsed.success) {
    return { message: `Seats must be a whole number from 0 to ${MAX_SEATS}.` };
  }

  const { slotId, seats, sold } = parsed.data;

  // Refused here first, with the same reason the API gives, so an operator on
  // a jetty does not spend a round trip to be told.
  const problem = capacityProblem(seats, sold);
  if (problem) return { slotId, message: problem };

  const { token, me } = await requireOperator();
  if (!me.canManage) return { slotId, message: ROLE_REFUSAL };

  try {
    const { error } = await operatorApi(token).PATCH("/slots/{id}", {
      params: { path: { id: slotId } },
      body: { seats },
    });
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { slotId, message: "No signal. Seats were not changed." };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 409) return { slotId, message: dedash(err.message) };
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { slotId, message: refusal };
      if (err.status === 403) {
        return {
          slotId,
          message: ROLE_REFUSAL,
        };
      }
      if (err.isNotFound) {
        return { slotId, message: "That departure is no longer here." };
      }
    }
    return { slotId, message: "Seats were not changed. Try again." };
  }

  revalidatePath("/calendar");
  revalidatePath("/today");
  return { slotId, seats };
}

/* ------------------------------------------------------------- blackouts */

export interface BlackoutState {
  message?: string;
  result?: { existingBookings: number; note?: string };
}

const blackoutSchema = z.object({
  from: z.string(),
  to: z.string(),
  reasonCode: z.enum(
    BLACKOUT_REASONS.map((r) => r.code) as [
      BlackoutReason,
      ...BlackoutReason[],
    ],
  ),
  note: z.string().max(500),
});

/**
 * Close dates to new bookings.
 *
 * **Closing dates is not cancelling people**, and that is the whole hazard. It
 * stops new sales and reports what the operator still owes travellers —
 * including people mid-checkout, whose holds predate the closure and can still
 * complete.
 *
 * "An operator who assumes closing the calendar cancelled the bookings will
 * simply not turn up", so the returned note is rendered whenever
 * `existingBookings > 0` rather than treated as an optional extra.
 */
export async function addBlackout(
  _prev: BlackoutState,
  form: FormData,
): Promise<BlackoutState> {
  const parsed = blackoutSchema.safeParse({
    from: form.get("from"),
    to: form.get("to"),
    reasonCode: form.get("reasonCode"),
    note: form.get("note") ?? "",
  });
  if (!parsed.success) return { message: "Pick both dates and a reason." };

  const { from, to, reasonCode, note } = parsed.data;
  const problem = blackoutProblem(from, to);
  if (problem) return { message: problem };

  const { token, me } = await requireOperator();
  if (!me.canManage) return { message: ROLE_REFUSAL };

  try {
    const { data, error } = await operatorApi(token).POST("/blackouts", {
      body: {
        from,
        to,
        reasonCode,
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    });
    if (error) throw error;

    revalidatePath("/calendar");
    revalidatePath("/today");
    return {
      result: {
        existingBookings: data.existingBookings ?? 0,
        note: dedashText(data.note),
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was closed." };
    }
    if (err instanceof OperatorApiError) {
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        return {
          message: ROLE_REFUSAL,
        };
      }
      if (err.status === 400) return { message: err.message };
    }
    return { message: "Nothing was closed. Try again." };
  }
}

/* --------------------------------------------------------- offline sales */

export interface Oversold {
  guests: number;
  bookings: string[];
  message: string;
  incidentId: string;
}

export interface OfflineSaleState {
  message?: string;
  result?: {
    /**
     * This entry, which is what `takeBackOfflineSale` sends back. Absent from
     * an API older than 2afd7b4, and then no undo is offered, because there is
     * nothing it could name.
     */
    id?: string;
    seatsRecorded: number;
    seatsRemaining: number;
    totalSoldOffline: number;
    oversold?: Oversold;
  };
}

const offlineSchema = z.object({
  slotId: z.string().min(1),
  seats: z.coerce.number().int().min(1).max(MAX_SEATS),
  note: z.string().max(500),
});

/**
 * Seats the operator sold at their own counter.
 *
 * **A report, not a request**, and it is accepted even when it is bad news:
 * "refusing it would not un-sell the seats — it would only keep our numbers
 * wrong until eleven people and a six-person boat meet at a jetty."
 *
 * The response can carry `oversold`, and surfacing that is the reason this
 * action exists rather than a plain fetch. Present means travellers who paid
 * us now have no seat. **The UI must not render a success state** — this is
 * the one screen in the portal where a green tick would be actively harmful.
 */
export async function recordOfflineSale(
  _prev: OfflineSaleState,
  form: FormData,
): Promise<OfflineSaleState> {
  const parsed = offlineSchema.safeParse({
    slotId: form.get("slotId"),
    seats: form.get("seats"),
    note: form.get("note") ?? "",
  });
  if (!parsed.success) {
    return { message: "How many seats did you sell? At least one." };
  }

  const { slotId, seats, note } = parsed.data;
  /*
    No role check: recording a counter sale is open to everybody signed in,
    staff included, as it is in the API (see `ROLE_REFUSAL`). A suspension is
    the API's one refusal here, and it is read below.
  */
  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/slots/{id}/offline-sales",
      {
        params: { path: { id: slotId } },
        body: { seats, ...(note.trim() ? { note: note.trim() } : {}) },
      },
    );
    if (error) throw error;

    revalidatePath("/calendar");
    revalidatePath(`/today/${slotId}`);

    const oversold = data.oversold;
    return {
      result: {
        ...(data.id ? { id: data.id } : {}),
        seatsRecorded: data.seatsRecorded ?? seats,
        seatsRemaining: data.seatsRemaining ?? 0,
        totalSoldOffline: data.totalSoldOffline ?? 0,
        ...(oversold
          ? {
              oversold: {
                guests: oversold.guests ?? 0,
                bookings: oversold.bookings ?? [],
                message: oversold.message ?? "",
                incidentId: oversold.incidentId ?? "",
              },
            }
          : {}),
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      // Emphatic on purpose: an operator who thinks a counter sale was
      // recorded and walks away leaves us selling seats that are gone.
      return { message: "No signal. The sale was NOT recorded. Try again." };
    }
    if (err instanceof OperatorApiError) {
      /*
        A suspended business is refused with `403 AccountSuspended`, which
        this read as "Not recorded. Try again." (op#90 f13): a retry that can
        never succeed, with the one fact that explains it hidden.
      */
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      /*
        No role sentence for a 403: the API gates no role here, so a refusal
        that is not a suspension is one this screen does not know, and the
        API's own words are the only honest thing to show.
      */
      if (err.status === 403) return { message: sentence(err.message) };
      if (err.isNotFound)
        return { message: "That departure is no longer here." };
      if (err.status === 400) return { message: err.message };
    }
    return { message: "Not recorded. Try again." };
  }
}

export interface TakeBackState {
  message?: string;
  /** The departure after the entry came back off it. */
  result?:
    | {
        seatsTakenBack: number;
        seatsRemaining: number;
        totalSoldOffline: number;
      }
    /*
      `409 already_taken_back`: "its seats are already back on the departure",
      so a tap whose first answer was lost has nothing left to do, and it is
      said as done rather than as a failure.
    */
    | { already: true };
}

const takeBackSchema = z.object({
  slotId: z.string().min(1),
  saleId: z.string().min(1),
});

/**
 * "That was a mistake": take one counter sale back (yuvoy-api#226, op#89 f12).
 *
 * A mistyped 20 instead of 2 takes the whole boat and refuses every accept on
 * the departure. The contract sent operators to "the counter sales screen" to
 * correct it, and there was no such screen because there was no route.
 *
 * The entry is NOT deleted. The API writes a second row cancelling it, both
 * stay on the record, and the seats come back. An honour incident the sale
 * raised is not withdrawn: somebody at Yuvoy closes it with what they found.
 * Open to everybody signed in, the same people who may record one.
 */
export async function takeBackOfflineSale(
  _prev: TakeBackState,
  form: FormData,
): Promise<TakeBackState> {
  const parsed = takeBackSchema.safeParse({
    slotId: form.get("slotId"),
    saleId: form.get("saleId"),
  });
  if (!parsed.success) return { message: "There is nothing to take back." };

  const { slotId, saleId } = parsed.data;
  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).DELETE(
      "/slots/{id}/offline-sales/{saleId}",
      { params: { path: { id: slotId, saleId } } },
    );
    if (error) throw error;

    revalidatePath("/calendar");
    revalidatePath(`/today/${slotId}`);

    return {
      result: {
        seatsTakenBack: data.seatsTakenBack,
        seatsRemaining: data.seatsRemaining,
        totalSoldOffline: data.totalSoldOffline,
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      // As emphatic as the record: the count on the departure is still wrong.
      return { message: "No signal. Nothing was taken back. Try again." };
    }
    if (err instanceof OperatorApiError) {
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 409 && err.code === "already_taken_back") {
        revalidatePath("/calendar");
        revalidatePath(`/today/${slotId}`);
        return { result: { already: true } };
      }
      /*
        `counter_sales_below_zero` and anything else the API refuses with: its
        own sentence says what to do instead ("record what you actually sold
        instead, or call us").
      */
      if (err.status === 409 || err.status === 403) {
        return { message: sentence(err.message) };
      }
      if (err.isNotFound) {
        return {
          message: "That counter sale is not on this departure any more.",
        };
      }
    }
    return { message: "Nothing was taken back. Try again." };
  }
}
