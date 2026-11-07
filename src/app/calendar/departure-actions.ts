"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import {
  BLACKOUT_REASONS,
  MAX_SEATS,
  type BlackoutReason,
} from "@/lib/day/capacity-types";
import {
  DEFAULT_CUTOFF_HOURS,
  DEFAULT_DURATION_MINUTES,
  countDepartures,
  departureProblem,
} from "@/lib/day/departures";
import { marketDays } from "@/lib/format/market-time";
import { dedash, dedashText } from "@/lib/format/dedash";
import { sentence } from "@/lib/format/sentence";
import { suspendedMessage } from "@/lib/account/suspended";
import { ROLE_REFUSAL } from "./role-refusal";

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
    /** The listing they were added to, for the receipt's way to it. */
    experienceId: string;
  };
}

const departureSchema = z.object({
  experienceId: z.string().min(1),
  fromDate: z.string(),
  toDate: z.string(),
  times: z.array(z.string()).min(1).max(12),
  /*
    At most seven: there are seven days, and a form can send the field as
    many times as it likes. An uncapped array here is what zod's mrhx
    advisory turns into memory use on the server.
  */
  weekdays: z.array(z.coerce.number().int().min(0).max(6)).max(7),
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
  /*
    Signed in first, before anything in the form is read. The parse is the
    one step here that a visitor with no session could otherwise make the
    server do, and somebody who may not manage departures is told that, not
    which field to fix.
  */
  const { token, me } = await requireOperator();
  if (!me.canManage) return { message: ROLE_REFUSAL };

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
          ? "Pick which listing these departures are for."
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

    revalidatePath("/calendar");
    revalidatePath("/today");
    return {
      result: {
        created: data.created ?? 0,
        asked,
        note: dedashText(data.note),
        onSale: data.onSale,
        notOnSaleDetail: dedashText(data.notOnSaleDetail),
        experienceId,
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was added." };
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
            "We could not find that listing. Reload the page and pick it again.",
        };
      }
      if (err.status === 400) return { message: err.message };
    }
    return { message: "Nothing was added. Try again." };
  }
}

/* --------------------------------------------------------------- reopen -- */

export interface ReopenState {
  message?: string;
  /** The API's own sentence, which gives both counts in words. */
  note?: string;
  /** Reopened, by this tap or before it. Either way, the day is refreshed. */
  done?: boolean;
}

/**
 * Put back on sale what one closure took off — yuvoy-operator#45 item 2.
 *
 * ## What it does NOT promise
 *
 * "Whether a reopened departure then sells is decided as for any departure, so
 * read `onSale` on `GET /slots` rather than assuming it." A called-off
 * departure is never reopened, and one held by a second closure still in force
 * stays closed. So this revalidates and lets the re-read say what actually
 * happened, rather than reporting success and drawing the day as open.
 *
 * The API's `note` "gives both counts in words" and is rendered verbatim: it is
 * the only thing on screen that can say "two went back and one did not".
 */
export async function reopenClosure(
  _prev: ReopenState,
  form: FormData,
): Promise<ReopenState> {
  const id = String(form.get("id") ?? "");
  if (!id) return { message: "Nothing to reopen." };

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/blackouts/{id}/reopen",
      { params: { path: { id } } },
    );
    if (error) throw error;

    /*
      NOT revalidated, and the note is why.

      A re-render is the truth about what is on sale now — and it takes the
      counts with it, because a reopened closure drops out of the day's list and
      unmounts the row that was holding them. The API says "say this out loud.
      It gives both counts in words", and it is the ONLY place "two went back and
      one did not" exists. So `ReopenClosure` hands the sentence up to the day's
      panel, which survives the refresh, and then refreshes (op#89 f16).

      The same trap `cancelBooking` hit: revalidate only when the re-render
      shows more than the returned value, and here it shows less.
    */
    return { done: true, note: dedashText(data.note) };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was reopened. Try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "already_reopened" || err.isNotFound) {
        /*
          Both mean the same thing to somebody looking at this screen: what you
          are reading is out of date. Reported as done rather than as an error,
          and the day is refreshed from the component.
        */
        return { done: true };
      }
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) return { message: ROLE_REFUSAL };
    }
    return { message: "Nothing was reopened. Try again." };
  }
}

/* ----------------------------------------------- close one departure ----- */

export interface CloseDepartureState {
  message?: string;
  /** The API's sentence about the bookings still on it. Rendered verbatim. */
  note?: string;
  done?: boolean;
}

const closeDepartureSchema = z.object({
  slotId: z.string().min(1),
  reasonCode: z.enum(
    BLACKOUT_REASONS.map((r) => r.code) as [
      BlackoutReason,
      ...BlackoutReason[],
    ],
  ),
  note: z.string().trim().max(500, "That note is longer than 500 characters."),
});

/**
 * Stop selling one departure — yuvoy-operator#45 item 4.
 *
 * "The departure-sized version of closing dates: this departure stops selling
 * and the rest of its day does not. **Closing is not cancelling people.** The
 * bookings on it still stand, and `note` says so when there are any."
 *
 * That sentence is the whole reason the receipt is rendered rather than
 * summarised. An operator who believes closing cancelled the bookings does not
 * turn up, and the people who paid are standing on a jetty.
 */
export async function closeDeparture(
  _prev: CloseDepartureState,
  form: FormData,
): Promise<CloseDepartureState> {
  const parsed = closeDepartureSchema.safeParse({
    slotId: String(form.get("slotId") ?? ""),
    reasonCode: String(form.get("reasonCode") ?? ""),
    note: String(form.get("note") ?? ""),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      message:
        String(issue.path[0]) === "note"
          ? issue.message
          : "Choose why it is not selling.",
    };
  }

  const { token } = await requireOperator();
  const { slotId, reasonCode, note } = parsed.data;

  try {
    const { data, error } = await operatorApi(token).POST("/slots/{id}/close", {
      params: { path: { id: slotId } },
      // Omitted when empty: an empty note is an absence, and storing one puts a
      // blank line on a closure where somebody will later look for a reason.
      body: { reasonCode, ...(note ? { note } : {}) },
    });
    if (error) throw error;

    /*
      Not revalidated, for the reason `reopenClosure` gives above.

      `note` is "present when `existingBookings` is above zero, and clients must
      render it verbatim" — it is the sentence that stops an operator believing
      closing cancelled the bookings, and a re-render drops the closed departure
      out of the list it was in and unmounts the panel holding it. The receipt
      stays; the day catches up on the operator's tap.
    */
    return { done: true, ...(data.note ? { note: dedash(data.note) } : {}) };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. It is still selling. Try again." };
    }
    if (err instanceof OperatorApiError) {
      if (
        err.code === "already_called_off" ||
        err.code === "departure_started"
      ) {
        /*
          Two different facts and two different next steps: it was called off,
          so there is nothing to close, or it has already left. The API writes
          both, and one sentence of ours would lose whichever it was.
        */
        return { message: dedash(err.message) };
      }
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) return { message: ROLE_REFUSAL };
      if (err.isNotFound) {
        return { message: "That departure is no longer here." };
      }
      if (err.status === 400) return { message: dedash(err.message) };
    }
    return { message: "It is still selling. Try again." };
  }
}

/* ------------------------------------------- confirm seats, many at once -- */

export interface ConfirmSeatsState {
  message?: string;
  /** Departures whose seats were confirmed. 0 is a real answer. */
  confirmed?: number;
}

/**
 * Confirm the seats on many departures at once (yuvoy-operator#94 item 2).
 *
 * "Seats set by hand stop being offered to travellers once nobody has
 * confirmed them for two days." An operator with a boat of hand-set seats
 * used to find out one departure at a time, by noticing it was off sale, and
 * confirm each by saving its seat count again.
 *
 * ## One call, with no dates (yuvoy-api#241)
 *
 * The counts Home and the hub show (`departuresNotOnSale`,
 * `departuresGoingOffSaleSoon`) have no end date, and the ranged form of this
 * call takes at most 31 days, so "Confirm all" used to sweep a year in twelve
 * windows and still could not reach past it. Since yuvoy-api#244 a request
 * with no dates confirms "every departure that `departuresNotOnSale` and
 * `departuresGoingOffSaleSoon` count ..., however far ahead it leaves": in the
 * contract's words, "the one call behind 'Confirm all'". So that is what is
 * sent, `{}` from Home and only `experienceId` from a listing's hub, and what
 * it confirms is exactly what the row counted.
 *
 * The year-long sweep that stood in for this while nobody could say whether
 * api.yuvoy.in ran #244 is gone: it has since 29 Sep 2026, confirmed on
 * yuvoy-operator#112 and checked from here on 3 Oct.
 *
 * Safe to send twice ("confirming twice leaves the departures as confirming
 * once did"), so a double tap on one bar of signal costs nothing. Seat counts
 * are not changed.
 */
export async function confirmSeats(
  _prev: ConfirmSeatsState,
  form: FormData,
): Promise<ConfirmSeatsState> {
  const experienceId = String(form.get("experienceId") ?? "").trim();

  const { token, me } = await requireOperator();
  if (!me.canManage) return { message: ROLE_REFUSAL };

  try {
    const { data, error } = await operatorApi(token).POST(
      "/slots/confirm-seats",
      {
        body: experienceId ? { experienceId } : {},
      },
    );
    if (error) throw error;

    revalidateConfirmed(experienceId);
    return {
      confirmed: Number.isInteger(data.confirmed) ? data.confirmed : 0,
    };
  } catch (err) {
    return confirmFailure(err);
  }
}

/**
 * Every screen that counts what is off sale re-reads: Home adds them up, the
 * calendar marks each departure, and the listing's own hub says how many. The
 * receipt lives in the control, which stays mounted on each.
 */
function revalidateConfirmed(experienceId: string) {
  revalidatePath("/today");
  revalidatePath("/calendar");
  if (experienceId) revalidatePath(`/today/listing/${experienceId}`);
}

function confirmFailure(err: unknown): ConfirmSeatsState {
  if (err instanceof OperatorNetworkError) {
    return { message: "No signal. Nothing was confirmed. Try again." };
  }
  if (err instanceof OperatorApiError) {
    const refusal = suspendedMessage(err);
    if (refusal) return { message: refusal };
    if (err.status === 403) return { message: ROLE_REFUSAL };
    if (err.isNotFound) {
      return { message: "That listing is not on this account any more." };
    }
    // The API writes its refusals in lower case for its logs; `sentence`
    // capitalises and ends them, and leaves the words alone.
    if (err.status === 400) return { message: sentence(err.message) };
  }
  return { message: "Nothing was confirmed. Try again." };
}
