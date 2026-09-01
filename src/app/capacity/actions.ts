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

/**
 * The three capacity writes.
 *
 * All three are OWNER or MANAGER, and all three refuse in ways that matter
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

  const { token } = await requireOperator();

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
      if (err.status === 409) return { slotId, message: err.message };
      if (err.status === 403) {
        return {
          slotId,
          message:
            "Your role cannot change capacity. An owner or manager has to.",
        };
      }
      if (err.isNotFound) {
        return { slotId, message: "That departure is no longer here." };
      }
    }
    return { slotId, message: "Seats were not changed. Try again." };
  }

  revalidatePath("/capacity");
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

  const { token } = await requireOperator();

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

    revalidatePath("/capacity");
    revalidatePath("/today");
    return {
      result: { existingBookings: data.existingBookings ?? 0, note: data.note },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was closed." };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 403) {
        return {
          message: "Your role cannot close dates. An owner or manager has to.",
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

    revalidatePath("/capacity");
    revalidatePath(`/today/${slotId}`);

    const oversold = data.oversold;
    return {
      result: {
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
      return { message: "No signal. The sale was NOT recorded — try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.isNotFound)
        return { message: "That departure is no longer here." };
      if (err.status === 400) return { message: err.message };
    }
    return { message: "Not recorded. Try again." };
  }
}
