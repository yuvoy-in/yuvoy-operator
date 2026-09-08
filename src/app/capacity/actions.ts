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
import {
  DEFAULT_CUTOFF_HOURS,
  DEFAULT_DURATION_MINUTES,
  countDepartures,
  departureProblem,
} from "@/lib/day/departures";
import { marketDays } from "@/lib/format/market-time";

/**
 * The four capacity writes.
 *
 * All four are OWNER or MANAGER, and all four refuse in ways that matter
 * more than they succeed — which is why every branch here says what actually
 * happened rather than "try again".
 */

export interface CapacityState {
  message?: string;
  seats?: number;
  slotId?: string;
}

/**
 * Said here, and said by the API. The page already hides the forms from
 * STAFF, but a Server Action is a public POST endpoint and roles change
 * between a render and a tap — `GET /me` is re-read on every action, so this
 * is the role at the moment of the tap. The contract's own 403 stays handled
 * below it, for the day the two disagree.
 */
const ROLE_REFUSAL =
  "Seats, closed dates and counter sales need an owner or a manager. Nothing was changed.";

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
  const { token, me } = await requireOperator();
  if (!me.canManage) return { message: ROLE_REFUSAL };

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

/* -------------------------------------------------------- new departures */

export interface DepartureState {
  message?: string;
  field?: string;
  result?: {
    created: number;
    asked: number;
    note?: string;
    /**
     * Whether those departures are actually for sale — yuvoy-operator#30 §4.
     *
     * Departures on a draft listing stay creatable, deliberately: "a calendar
     * you cannot fill in before the listing is approved is not a calendar."
     * What was wrong was the SILENCE — the screen said "they are on sale from
     * now" unconditionally, which is untrue for a draft, an unpriced listing,
     * a withdrawn one, or an operator not selling. Production held a draft
     * listing with hundreds of departures no traveller could book.
     */
    onSale?: boolean;
    /** A sentence to render VERBATIM. Present only when `onSale` is false. */
    notOnSaleDetail?: string;
  };
}

const departureSchema = z.object({
  experienceId: z.string().min(1),
  fromDate: z.string(),
  toDate: z.string(),
  times: z.array(z.string()).min(1).max(12),
  weekdays: z.array(z.coerce.number().int().min(0).max(6)),
  seats: z.coerce.number().int().min(1).max(MAX_SEATS),
  /*
    Empty is not zero. The field is optional in the contract and "defaults to
    `seats`", so an untouched input must be omitted rather than sent as 0 —
    which would be a boat that physically holds nobody.
  */
  capacity: z.union([
    z.literal(""),
    z.coerce.number().int().min(1).max(MAX_SEATS),
  ]),
  durationMinutes: z.coerce.number().int().min(15).max(1440),
  cutoffHours: z.coerce.number().int().min(0).max(168),
});

/**
 * Create departures.
 *
 * The one thing the capacity screen could not do. Until `POST /slots` an
 * operator wanting a Saturday morning trip had to ask somebody at Yuvoy.
 *
 * **`created: 0` is a success.** "Dates that already have a departure at that
 * time are left alone, so `created: 0` is a legitimate answer and not a
 * failure — a retry after a timeout does not sell the same boat twice." So the
 * result carries both what was asked for and what was made, and the screen
 * says which of the two happened rather than rendering an error over an
 * idempotent no-op.
 *
 * **404 is the answer for another operator's listing**, never 403: "you may
 * not touch that" confirms it is there. The copy here must not undo that by
 * implying the listing exists and is somebody else's.
 */
export async function addDepartures(
  _prev: DepartureState,
  form: FormData,
): Promise<DepartureState> {
  const parsed = departureSchema.safeParse({
    experienceId: form.get("experienceId"),
    fromDate: form.get("fromDate"),
    toDate: form.get("toDate"),
    /*
      NOT filtered for empties. An empty time input is a half-filled form, and
      dropping it here would have the server create fewer departures than the
      operator was shown a count for — `departureProblem` refuses it instead,
      with the same sentence the form already showed.
    */
    times: form.getAll("times").map(String),
    weekdays: form.getAll("weekdays").map(String).filter(Boolean),
    seats: form.get("seats"),
    capacity: form.get("capacity") ?? "",
    /*
      `||`, not `??`, for both of these. A cleared number field submits `""`,
      and `z.coerce.number()` reads `""` as **0** — so `??` would turn "I
      emptied the box" into "bookings close 0 hours before departure", which is
      a departure sellable up to the moment it leaves. `"0"` is a non-empty
      string and still reaches the schema, so a deliberate zero survives.
    */
    durationMinutes: form.get("durationMinutes") || DEFAULT_DURATION_MINUTES,
    cutoffHours: form.get("cutoffHours") || DEFAULT_CUTOFF_HOURS,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = String(issue.path[0] ?? "");
    return {
      field,
      message:
        field === "experienceId"
          ? "Pick which trip these departures are for."
          : field === "seats"
            ? `How many seats? From 1 to ${MAX_SEATS}.`
            : "Something in the form was not right. Check it and try again.",
    };
  }

  const { experienceId, capacity, ...plan } = parsed.data;

  /*
    The market's today, not the phone's. A device an hour behind would let
    somebody add a departure to a day that has already gone in the Andamans,
    and the API would take it.
  */
  const { today } = await marketDays();
  const problem = departureProblem(plan, today);
  if (problem) return problem;

  const { token, me } = await requireOperator();
  if (!me.canManage) return { message: ROLE_REFUSAL };

  const asked = countDepartures(plan);

  try {
    const { data, error } = await operatorApi(token).POST("/slots", {
      body: {
        experienceId,
        fromDate: plan.fromDate,
        toDate: plan.toDate,
        times: plan.times,
        /*
          Omitted rather than sent empty. "Empty means every day in the range,
          which is what a one-off departure wants" — and an empty array would
          say the same thing, but omitting it is what the contract describes
          and keeps the two readings from ever diverging.
        */
        ...(plan.weekdays.length ? { weekdays: plan.weekdays } : {}),
        seats: plan.seats,
        ...(typeof capacity === "number" ? { capacity } : {}),
        durationMinutes: plan.durationMinutes,
        cutoffHours: plan.cutoffHours,
      },
    });
    if (error) throw error;

    revalidatePath("/capacity");
    revalidatePath("/today");
    return {
      result: {
        created: data.created ?? 0,
        asked,
        note: data.note,
        onSale: data.onSale,
        notOnSaleDetail: data.notOnSaleDetail,
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was added." };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 403) {
        return {
          message:
            "Your role cannot add departures. An owner or manager has to.",
        };
      }
      if (err.isNotFound) {
        /*
          The contract answers 404 for a listing belonging to another operator
          precisely so a 403 cannot confirm it is there. Saying "that is not
          yours" here would hand back the confirmation the status code was
          chosen to withhold.
        */
        return {
          field: "experienceId",
          message:
            "We could not find that trip. Reload the page and pick it again.",
        };
      }
      if (err.status === 400) return { message: err.message };
    }
    return { message: "Nothing was added. Try again." };
  }
}
