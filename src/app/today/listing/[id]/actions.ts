"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { suspendedMessage } from "@/lib/account/suspended";
import { dedash } from "@/lib/format/dedash";

/**
 * The listing hub's writes — yuvoy-operator#56 items 8 and 9.
 *
 * ## One role gate, said here as well as by the API
 *
 * Every write below is OWNER, ADMIN or MANAGER, and `GET /me` is re-read on
 * every action so it is the role at the moment of the tap. A disabled control
 * is a courtesy; a Server Action is a public POST endpoint.
 */

const ROLE_REFUSAL =
  "Only owners, admins and managers can change a listing's departures.";

/* ------------------------------------------------------ weekly schedule -- */

export interface ScheduleState {
  message?: string;
  /** `weekly[2].startTime` → the message for that row, from `details`. */
  rowProblems?: Record<string, string>;
  /** The API's own sentence about what saving did. Rendered verbatim. */
  note?: string;
  /** Present when the listing is not on sale afterwards, and says why. */
  notOnSaleDetail?: string;
  done?: boolean;
}

const scheduleSchema = z.object({
  experienceId: z.string().min(1),
  weekly: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      startTime: z.string().regex(/^\d{2}:\d{2}$/, "Times look like 07:00."),
      seats: z.number().int().min(1).max(200),
    }),
  ),
});

/**
 * Save the whole weekly schedule.
 *
 * "It is the whole schedule": a row left out is a row removed, which is why an
 * empty save asks first. Departures the schedule made are closed to new
 * bookings rather than cancelled, and the bookings on them stay — the closure
 * the save creates reads back on `GET /blackouts` with `SCHEDULE_CHANGED`.
 */
export async function saveSchedule(
  _prev: ScheduleState,
  form: FormData,
): Promise<ScheduleState> {
  const raw = String(form.get("weekly") ?? "[]");
  let rows: unknown;
  try {
    rows = JSON.parse(raw);
  } catch {
    return { message: "We could not read that schedule. Try again." };
  }

  /*
    Spelled out rather than passed by shorthand. `pnpm qa` reads the object
    handed to `safeParse` and fails a schema field that never appears in it —
    the guard from yuvoy-operator#60, where a waiver an operator picked was
    dropped on the floor because the field was missing from exactly this call
    and it still typechecked. Shorthand hid the field from the guard, which is
    the guard being stricter than it needs to be and cheap to satisfy.
  */
  const parsed = scheduleSchema.safeParse({
    experienceId: String(form.get("experienceId") ?? ""),
    weekly: rows,
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { message: issue.message };
  }

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).PUT(
      "/experiences/{id}/schedule",
      {
        params: { path: { id: parsed.data.experienceId } },
        body: { weekly: parsed.data.weekly },
      },
    );
    if (error) throw error;

    revalidatePath(`/today/listing/${parsed.data.experienceId}`);
    revalidatePath("/today");
    revalidatePath("/calendar");
    return {
      done: true,
      ...(data.note ? { note: dedash(data.note) } : {}),
      /*
        Saving a schedule does not make a listing sell. "When `onSale` is false,
        also `notOnSaleDetail` verbatim" — an operator who has just built a week
        of departures needs to know none of them are buyable, and why.
      */
      ...(data.onSale === false && data.notOnSaleDetail
        ? { notOnSaleDetail: dedash(data.notOnSaleDetail) }
        : {}),
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. The schedule was not saved." };
    }
    if (err instanceof OperatorApiError) {
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) return { message: ROLE_REFUSAL };
      if (err.status === 400) {
        /*
          `details` names the row and the field: keys like `weekly[2].startTime`.
          Carried through so the form can mark that row rather than printing one
          sentence above seven of them.
        */
        const details = err.details;
        const rowProblems =
          details && typeof details === "object"
            ? Object.fromEntries(
                Object.entries(details as Record<string, unknown>).map(
                  ([key, value]) => [key, String(value)],
                ),
              )
            : undefined;
        return { message: dedash(err.message), rowProblems };
      }
    }
    return { message: "The schedule was not saved. Try again." };
  }
}

/* --------------------------------------------------------- departures --- */

export interface DepartureState {
  message?: string;
  note?: string;
  done?: boolean;
  /**
   * Bookings on a moved departure that nothing could carry the new time to
   * (op#89). Present only when above zero. The move still happened and their
   * booking page shows it; the operator is the only one who can tell them.
   */
  notReached?: number;
}

/**
 * Move a departure's time — #56 item 9.
 *
 * The instant is built from the departure's OWN market date and the chosen
 * `HH:MM` at `+05:30`, because "the new time has to be on the same day": a
 * client that sent a UTC instant would move a 05:00 boat to the previous day
 * and meet `409 different_day` without knowing why.
 */
export async function moveDeparture(
  _prev: DepartureState,
  form: FormData,
): Promise<DepartureState> {
  const slotId = String(form.get("slotId") ?? "");
  const day = String(form.get("day") ?? "");
  const time = String(form.get("startTime") ?? "");
  if (
    !slotId ||
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !/^\d{2}:\d{2}$/.test(time)
  ) {
    return { message: "Times look like 07:00." };
  }

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).PATCH("/slots/{id}/time", {
      params: { path: { id: slotId } },
      body: { startsAt: `${day}T${time}:00+05:30` },
    });
    if (error) throw error;

    /*
      `bookingsTold` counts messages actually queued since yuvoy-api#200, and
      `bookingsNotReached` is the rest: "present only when it is more than
      zero". Read as optional, so an older API reads as everybody reached,
      which is what it used to claim.
    */
    const notReached =
      Number.isInteger(data.bookingsNotReached) &&
      (data.bookingsNotReached ?? 0) > 0
        ? (data.bookingsNotReached as number)
        : 0;
    revalidatePath("/today");
    revalidatePath("/calendar");
    return {
      done: true,
      ...(data.note ? { note: dedash(data.note) } : {}),
      ...(notReached > 0 ? { notReached } : {}),
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was moved." };
    }
    if (err instanceof OperatorApiError) {
      /*
        Three different facts and three different next steps, which is why they
        are three codes and not one message.
      */
      if (err.code === "departure_started") {
        return {
          message: "Too close to its start to move. Call it off instead.",
        };
      }
      if (err.code === "different_day") {
        return { message: "The new time has to be on the same day." };
      }
      if (err.code === "time_taken") {
        return {
          message: "This listing already has a departure at that time.",
        };
      }
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) return { message: ROLE_REFUSAL };
      if (err.isNotFound)
        return { message: "That departure is no longer here." };
    }
    return { message: "Nothing was moved. Try again." };
  }
}
