"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import {
  PAUSE_REASONS,
  describeBlockers,
  type PauseReason,
} from "@/lib/services/listings";
import { dedashText } from "@/lib/format/dedash";
import { suspendedMessage } from "@/lib/account/suspended";
import { saleInProgressMessage } from "./sale-in-progress";

export interface PauseState {
  message?: string;
  /**
   * What was typed, handed back so a refusal does not empty the form. See the
   * note in `pauseListing`.
   */
  typed?: { reasonCode?: string };
  /** Bumped per attempt, so the form remounts and re-reads its defaults. */
  attempt?: number;
  /** Set on success, so the row can say exactly what did and did not happen. */
  done?: {
    upcomingDepartures: number;
    bookingsToHonour: number;
    guestsToHonour: number;
    /** The API's own sentence, rendered VERBATIM. See below. */
    note?: string;
    /** What happens next, in the API's words. See below. */
    next?: string;
  };
}

const pauseSchema = z.object({
  id: z.string().min(1),
  reasonCode: z.enum(
    PAUSE_REASONS.map((r) => r.code) as [PauseReason, ...PauseReason[]],
  ),
  note: z.string().trim().optional(),
  confirmExperienceId: z.string().trim().min(1),
});

/**
 * Pausing your own listing — yuvoy-operator#30 §6, #44.
 *
 * `POST /experiences/{id}/pause`, "the word the product uses". It is the same
 * handler as `withdraw` under its older name, same body, same answer; the old
 * name is kept by the API for a deployed portal and is no longer called here.
 *
 * ## It cancels nothing, and the screen says so twice
 *
 * "Pausing cancels nothing and refunds nothing. Everybody already booked still
 * has their seat and still expects you at the meeting point." An operator who
 * assumes otherwise **will not turn up**, which is the single worst outcome
 * this action can produce — so the form says it before, and the API's own
 * `note` says it after, verbatim.
 *
 * ## `next` is rendered again
 *
 * It was suppressed. The API sent "ask us to put it back … we check it before
 * travellers see it again", which D-032.4 had made false: resuming is the
 * operator's own switch and is immediate. Rendering the server's sentence is
 * the rule; rendering a server sentence that sends an operator to wait for a
 * review that does not exist is not.
 *
 * yuvoy-api#167 fixed the wording — it now says that resuming is the
 * operator's own button and needs nobody at Yuvoy — so the suppression is
 * lifted and the sentence is printed verbatim, like `note` beside it. Raised
 * and closed on yuvoy-operator#44.
 *
 * ## Confirmed by name, not by a checkbox
 *
 * The contract's reason, and it is the same call the departure call-off makes:
 * "a checkbox is one mis-tap on a wet phone away from taking a live listing off
 * sale". The question names the listing, and the form fills
 * `confirmExperienceId` with the listing it was opened on (owner ruling, 3 Oct
 * 2026: a named confirm everywhere, replacing the id typed back;
 * yuvoy-api#261). The comparison happens here as well as at the API, because a
 * Server Action is a public POST endpoint whatever the form does.
 */
export async function pauseListing(
  _prev: PauseState,
  form: FormData,
): Promise<PauseState> {
  const parsed = pauseSchema.safeParse({
    id: String(form.get("id") ?? ""),
    reasonCode: String(form.get("reasonCode") ?? ""),
    note: String(form.get("note") ?? ""),
    confirmExperienceId: String(form.get("confirmExperienceId") ?? ""),
  });
  /*
    A refusal must not empty the form.

    React resets a form when its action completes and these inputs are
    uncontrolled, so a refusal used to clear the chosen REASON as well, and
    the next attempt then failed validation for a different reason than the
    one on screen. Found by an e2e walkthrough that typed a wrong id first,
    back when the id was typed. The same defect shipped on `/sign-in` and
    `/signup` and is fixed there the same way.
  */
  const typed = {
    reasonCode: String(form.get("reasonCode") ?? "") || undefined,
  };
  const again = (message: string): PauseState => ({
    message,
    typed,
    attempt: (_prev.attempt ?? 0) + 1,
  });

  if (!parsed.success) {
    return again("Pick a reason for pausing it. Nothing changed.");
  }

  const { id, reasonCode, note, confirmExperienceId } = parsed.data;
  if (confirmExperienceId !== id) {
    // Said here rather than forwarded, because the API's 400 for this is not a
    // sentence an operator can act on. The form sends its own listing, so this
    // is a forged or stale POST.
    return again("That confirm was for another listing. Nothing changed.");
  }

  const { token, me } = await requireOperator();
  if (!me.canManage) {
    return again(
      "Your role cannot pause a listing. An owner, admin or manager has to.",
    );
  }

  try {
    const { data, error } = await operatorApi(token).POST(
      "/experiences/{id}/pause",
      {
        params: { path: { id } },
        body: { reasonCode, confirmExperienceId, ...(note ? { note } : {}) },
      },
    );
    if (error) throw error;

    /*
      Revalidate AND hand back the numbers. The list has to stop showing it as
      on sale immediately — but the row going quiet is not enough on its own,
      because what an operator most needs to know is what they still owe.
    */
    /*
      `/today` and `/account` draw a listing's state, and so does the listing's
      own hub, which is where this control lives now. The hub was left out, so
      it went on saying "Paused" after a resume until a reload (op#89 f16).
      Revalidating it is safe for the receipt: `PauseResume` is always mounted
      on the hub and keeps its answer in action state across the re-render.
    */
    revalidatePath("/today");
    revalidatePath("/account");
    revalidatePath(`/today/listing/${id}`);
    return {
      done: {
        upcomingDepartures: data.upcomingDepartures,
        bookingsToHonour: data.bookingsToHonour,
        guestsToHonour: data.guestsToHonour,
        note: dedashText(data.note),
        // Verbatim, through the same dash strip every API sentence goes
        // through at this boundary — the copy rule cannot reach yuvoy-api's
        // database, so it is applied where the text enters.
        next: dedashText(data.next),
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return again("No signal. Nothing was sent. It is still on sale.");
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "already_off_sale") {
        return again("This one is not on sale, so there is nothing to pause.");
      }
      /*
        Somebody is mid-checkout on it, or a request on it is waiting. "Withdrawing
        is never urgent", so it is said as a wait, and with the wait's end:
        an accepted request holds for up to twelve hours, so "try again in a few
        minutes" was false. `details.heldUntil` names it; see the helper.
      */
      if (err.code === "sale_in_progress") {
        return again(
          saleInProgressMessage(err.details, err.message, Date.now()),
        );
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return again(refusal);
      if (err.status === 403) {
        return again(
          "Your role cannot pause a listing. An owner, admin or manager has to.",
        );
      }
      if (err.isNotFound) {
        return again("That listing is not on this account any more.");
      }
    }
    return again("Could not pause it. Nothing changed.");
  }
}

export interface ResumeState {
  message?: string;
  /** What the API says the listing is now. See `resumeListing` for `in_review`. */
  done?: {
    state: "published" | "in_review";
    /**
     * The API's own sentence about what happens next, rendered verbatim.
     *
     * Suppressed until yuvoy-api#167, because it said "Travellers can see it
     * and book it now" unconditionally — false for a listing resumed while the
     * account or its documents stop sales. It is chosen by what is true now:
     * back on sale; back on the listings but not bookable while something on
     * the account stops sales; or, for a listing never approved, still waiting
     * for its first check.
     */
    next?: string;
  };
}

const resumeSchema = z.object({ id: z.string().min(1) });

/** `details.missing` off a refusal, as field names — or nothing. */
function missingFields(details: unknown): string[] {
  if (!details || typeof details !== "object") return [];
  const missing = (details as { missing?: unknown }).missing;
  return Array.isArray(missing)
    ? missing.filter((m): m is string => typeof m === "string" && m !== "")
    : [];
}

/**
 * Resuming your own paused listing — yuvoy-operator#44, D-032.4.
 *
 * `POST /experiences/{id}/resume`. "Immediate. No queue, no admin." The owner
 * reversed the morning's review queue after reading the product demo: a pause
 * is "the boat is out of the water this fortnight", and if coming back costs a
 * wait nobody pauses at all — they leave the listing selling and decline the
 * bookings, which is worse for the traveller.
 *
 * ## Two answers, and neither is taken on the API's word alone
 *
 *   - `published` — back on sale, IF nothing else stops it. The API's `next`
 *     used to claim "Travellers can see it and book it now" unconditionally,
 *     which is false for "a listing resumed while your insurance is lapsed or
 *     your account is not live", so the screen suppressed it. yuvoy-api#167
 *     made the sentence conditional on what is actually true, so it is printed
 *     verbatim again — alongside the re-rendered row, whose own label still
 *     says whether anything on the account stops sales.
 *   - `in_review` — a listing awaiting its FIRST approval "does not move".
 *     Idempotent and not an error, and not a sentence about being on sale.
 *
 * ## Refused with what is missing
 *
 * `400` carries `details.missing` in the revision body's spelling, which
 * `describeBlockers` already turns into words — so the refusal names the
 * fields rather than saying "something is missing".
 */
export async function resumeListing(
  _prev: ResumeState,
  form: FormData,
): Promise<ResumeState> {
  const parsed = resumeSchema.safeParse({ id: String(form.get("id") ?? "") });
  if (!parsed.success) {
    return {
      message: "That listing could not be resumed. Refresh and try again.",
    };
  }
  const { id } = parsed.data;

  const { token, me } = await requireOperator();
  if (!me.canManage) {
    return {
      message:
        "Your role cannot resume a listing. An owner, admin or manager has to.",
    };
  }

  try {
    const { data, error } = await operatorApi(token).POST(
      "/experiences/{id}/resume",
      { params: { path: { id } } },
    );
    if (error) throw error;

    // The row's own label moves — Paused becomes Live, or Not selling — and
    // says more about the listing than a message could.
    /*
      `/today` and `/account` draw a listing's state, and so does the listing's
      own hub, which is where this control lives now. The hub was left out, so
      it went on saying "Paused" after a resume until a reload (op#89 f16).
      Revalidating it is safe for the receipt: `PauseResume` is always mounted
      on the hub and keeps its answer in action state across the re-render.
    */
    revalidatePath("/today");
    revalidatePath("/account");
    revalidatePath(`/today/listing/${id}`);
    return {
      done: {
        state: data.state === "in_review" ? "in_review" : "published",
        next: dedashText(data.next),
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing changed. It is still paused." };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 400) {
        const missing = missingFields(err.details);
        return {
          message: missing.length
            ? `It cannot go back on sale yet. Still missing: ${describeBlockers(missing).join(", ")}.`
            : "It cannot go back on sale yet. Something it needs is missing. Propose a change to fill it in.",
        };
      }
      if (err.code === "not_withdrawn") {
        return {
          message:
            "It is not paused, so there is nothing to resume. Refresh to see where it is.",
        };
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        return {
          message:
            "Your role cannot resume a listing. An owner, admin or manager has to.",
        };
      }
      if (err.isNotFound) {
        return { message: "That listing is not on this account any more." };
      }
    }
    return { message: "Could not resume it. Nothing changed." };
  }
}
