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

/**
 * O7 — an operator writes their own listing, and proposes changes to it.
 *
 * ## The decision behind this screen existing at all
 *
 * "Operators author them" (owner, 2026-09-05, on yuvoy-operator#8). The
 * question was open for a month and either answer was fine as long as somebody
 * said it; this is the answer.
 *
 * ## Two verbs, and they are not the same one
 *
 * `POST /experiences` **creates a draft** and reaches nobody.
 * `POST /experiences/{id}/revisions` **proposes a change** and is never a
 * write to the live listing: "a published listing is what travellers are
 * booking against right now, and editing it in place lets a price change
 * between somebody reading it and somebody paying."
 *
 * So neither action here returns anything resembling "Saved". An operator who
 * submits and sees a tick will assume they are selling, and will ring us on
 * the day nobody books.
 *
 * ## No role gate
 *
 * `POST /experiences` declares a generic `Forbidden` and names no role;
 * revisions are under the `capacity` tag, which `canManage` covers. The screen
 * says nothing about who may do this, because inventing a permission the
 * server does not have is the direction that costs an operator work they were
 * allowed to do.
 */

/* --------------------------------------------------------------- create -- */

/*
  `CreateState`, `createSchema` and `createListing` were here, and the listing
  builder replaced all three (yuvoy-operator#58 item 7). Creating is now the
  Basics step's own `POST /experiences`, which sends the four fields that step
  asks for and lets every later step `PATCH` the rest onto the draft.

  Deleted rather than left behind. A second create path is a second place for
  the defaults, the market refusal and the screener to drift, and #60 was
  exactly that drift: a waiver an operator picked was dropped on the floor by
  the create action while the form beside it looked correct.
*/

/* ------------------------------------------------------------- revision -- */

export interface RevisionState {
  message?: string;
  /** Set when the change is with us. Never "saved". */
  submitted?: boolean;
}

/**
 * Propose a change, or send a draft for review.
 *
 * The same endpoint does both, and the screen says two different things about
 * it — submitting a draft moves it to `in_review`, while submitting against a
 * live listing leaves it selling on the old terms until we answer.
 *
 * The body is `additionalProperties: true` — "the fields to change, any subset
 * of the listing" — so this sends only the fields the form actually carried.
 * Sending the whole listing back would turn every submission into a claim
 * about every field, including ones the operator never looked at.
 */
const revisionSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(3).optional(),
  summary: z.string().trim().optional(),
  description: z.string().trim().optional(),
  meetingPoint: z.string().trim().optional(),
  safetyNotes: z.string().trim().optional(),
  unitPrice: z
    .string()
    .trim()
    .transform((v) => v.replace(/[,\s₹]/g, ""))
    .pipe(z.string().regex(/^\d*$/, "A price in whole rupees, digits only."))
    .optional(),
  /*
    The basis, on an edit too. Every listing written before yuvoy-operator#30
    has whatever the column defaulted to, so the edit form is where the
    unstated ones actually get answered — the create form only fixes the ones
    written from now on.
  */
  pricingUnit: z.enum(["per_person", "per_group"]).optional(),
  /*
    WHAT THE THING ACTUALLY IS, ON AN EDIT TOO — yuvoy-operator#39.

    `activityType` became mandatory with the taxonomy and was on the create
    form only, so a listing written before it could never acquire one: the
    operator edits a summary, the submit succeeds because the API marks the
    field `SubmitDeferred` for exactly this reason, and approval refuses days
    later naming a control that was not on their screen. All three older
    production listings were in that state.

    Not an enum: the set grows by INSERT, so the value is checked by the
    server against the listing's own category — the pair is a composite
    foreign key — and the picker is narrowed to that category rather than
    validated here.
  */
  activityType: z.string().trim().optional(),
  /*
    The material changes the contract names — yuvoy-operator#30 §5.

    "Changes to price, safety notes, inclusions, requirements, duration or
    party size are *material* and need review before going live." Every one of
    those was in the contract and settable nowhere in this portal, which is why
    every listing carries the server's defaults.

    The revision body is `additionalProperties: true` with no declared fields,
    so the spelling comes from the CREATE body — the one place the names are
    declared. `publishBlockers` uses the same spellings, which is the second
    confirmation.
  */
  durationMinutes: z
    .string()
    .trim()
    .pipe(z.string().regex(/^\d*$/, "Minutes, digits only."))
    .optional(),
  maxPartySize: z
    .string()
    .trim()
    .pipe(z.string().regex(/^\d*$/, "A number of people, digits only."))
    .optional(),
  /*
    Arrays on the wire, one per line on the form. An operator writes "Mask and
    fins" on its own line, not as a comma-separated string they have to think
    about escaping — and blank lines are dropped rather than sent as empty
    inclusions nobody typed.
  */
  inclusions: z.string().optional(),
  requirements: z.string().optional(),
});

/** One per line, trimmed, blanks dropped. */
function lines(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export async function submitRevision(
  _prev: RevisionState,
  form: FormData,
): Promise<RevisionState> {
  const raw = {
    id: String(form.get("id") ?? ""),
    title: form.has("title") ? String(form.get("title")) : undefined,
    summary: form.has("summary") ? String(form.get("summary")) : undefined,
    description: form.has("description")
      ? String(form.get("description"))
      : undefined,
    meetingPoint: form.has("meetingPoint")
      ? String(form.get("meetingPoint"))
      : undefined,
    safetyNotes: form.has("safetyNotes")
      ? String(form.get("safetyNotes"))
      : undefined,
    unitPrice: form.has("unitPrice")
      ? String(form.get("unitPrice"))
      : undefined,
    /*
      Absent when no radio is checked, which on this form means the listing had
      no stored basis and the operator did not answer. Left out of the body
      rather than defaulted, for the same reason the create form refuses one.
    */
    pricingUnit: form.get("pricingUnit")
      ? String(form.get("pricingUnit"))
      : undefined,
    durationMinutes: form.has("durationMinutes")
      ? String(form.get("durationMinutes"))
      : undefined,
    maxPartySize: form.has("maxPartySize")
      ? String(form.get("maxPartySize"))
      : undefined,
    inclusions: form.has("inclusions")
      ? String(form.get("inclusions"))
      : undefined,
    requirements: form.has("requirements")
      ? String(form.get("requirements"))
      : undefined,
    /*
      Absent when the vocabulary read failed and the picker was not rendered,
      which must not read as "clear it". Empty string is the operator leaving
      "Choose one" selected on a listing that never had one — also not a
      change, and dropped below rather than sent as a blank.
    */
    activityType: form.get("activityType")
      ? String(form.get("activityType"))
      : undefined,
  };

  const parsed = revisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { message: parsed.error.issues[0].message };
  }

  const {
    id,
    unitPrice,
    durationMinutes,
    maxPartySize,
    inclusions,
    requirements,
    ...fields
  } = parsed.data;

  /*
    Only what changed. An empty string is a deliberate clearing and is sent;
    an absent field was not on the form and is not mentioned at all.
  */
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) body[key] = value;
  }
  if (unitPrice !== undefined && unitPrice !== "") {
    body.unitPricePaise = Number(unitPrice) * 100;
  }
  /*
    Numbers only when non-empty. A cleared box is NOT a change to zero — a
    zero-minute activity is not a thing an operator means, and the server's
    value is better than a number nobody typed.
  */
  if (durationMinutes) body.durationMinutes = Number(durationMinutes);
  if (maxPartySize) body.maxPartySize = Number(maxPartySize);
  /*
    Arrays, unlike the numbers above, ARE clearable: an empty box means "there
    is nothing included", which is a real answer and different from silence.
    The field is only in the body when it was on the form at all.
  */
  const included = lines(inclusions);
  if (included !== undefined) body.inclusions = included;
  const required = lines(requirements);
  if (required !== undefined) body.requirements = required;

  if (Object.keys(body).length === 0) {
    return { message: "Nothing has changed, so there is nothing to send." };
  }

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).POST(
      "/experiences/{id}/revisions",
      { params: { path: { id } }, body },
    );
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was sent. Try again." };
    }
    if (err instanceof OperatorApiError && err.code === "payload_too_large") {
      // See the create action above. No retry: the same body fails the same.
      return {
        message:
          "That is more text than we can accept in one go. Shorten the longest box (the lists and the safety notes are the usual culprits) and send it again.",
      };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 409) {
        return {
          message:
            "There is already a change with us on this listing. We will come back to you on that one first.",
        };
      }
      if (err.isNotFound) {
        return { message: "That listing is not on this account any more." };
      }
      if (err.status === 400 && err.message) return { message: err.message };
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        return { message: "You cannot change listings on this account." };
      }
    }
    return { message: "It was not sent. Try again." };
  }

  /*
    NOTHING is revalidated here, and that is the fix rather than an omission.

    `revalidatePath` invalidates the whole client router cache, so the route the
    operator is standing on re-renders too. This one is called from
    `/account/listings/{id}/edit`, which REDIRECTS as soon as the status becomes
    `in_review` or `live_changes_in_review` (#58 item 6) — so the operator would
    be moved to another screen before reading the one sentence that says who has
    their change now. The listing's own screen shows the new state the moment
    they go to it.
  */
  return { submitted: true };
}

export interface PauseState {
  message?: string;
  /**
   * What was typed, handed back so a refusal does not empty the form. See the
   * note in `pauseListing`.
   */
  typed?: { reasonCode?: string; confirmExperienceId?: string };
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
 * ## Confirmed by typing the id, not by a checkbox
 *
 * The contract's reason, and it is the same call the departure call-off makes:
 * "a checkbox is one mis-tap on a wet phone away from taking a live listing off
 * sale". The comparison happens here as well as at the API, because a Server
 * Action is a public POST endpoint whatever the form does.
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
    uncontrolled, so a mistyped id used to clear the chosen REASON as well —
    and the next attempt then failed validation for a different reason than the
    one on screen. Found by an e2e walkthrough that typed a wrong id first,
    which is exactly what a person does. The same defect shipped on `/sign-in`
    and `/signup` and is fixed there the same way.
  */
  const typed = {
    reasonCode: String(form.get("reasonCode") ?? "") || undefined,
    confirmExperienceId:
      String(form.get("confirmExperienceId") ?? "") || undefined,
  };
  const again = (message: string): PauseState => ({
    message,
    typed,
    attempt: (_prev.attempt ?? 0) + 1,
  });

  if (!parsed.success) {
    return again("Pick a reason, and type the listing's id to confirm.");
  }

  const { id, reasonCode, note, confirmExperienceId } = parsed.data;
  if (confirmExperienceId !== id) {
    // Said here rather than forwarded, because the API's 400 for this is not a
    // sentence an operator can act on and the mismatch is knowable on screen.
    return again("That id does not match this listing. Nothing changed.");
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
      `/today` and `/account`, which are the two screens that draw a listing's
      state — the old Listings page is a redirect since #56. Neither is the
      route these are called from (`/account/listings/...`), so the receipt
      each of these returns survives the revalidation rather than being
      unmounted by it.
    */
    revalidatePath("/today");
    revalidatePath("/account");
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
        Somebody is mid-checkout on it. "Withdrawing now would strand them at
        the payment step … holds are ten minutes, and withdrawing is never
        urgent." Said as a wait, because that is the whole answer.
      */
      if (err.code === "sale_in_progress") {
        return again(
          "Somebody is paying for this listing right now. Try again in a few minutes. Nothing changed.",
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
      `/today` and `/account`, which are the two screens that draw a listing's
      state — the old Listings page is a redirect since #56. Neither is the
      route these are called from (`/account/listings/...`), so the receipt
      each of these returns survives the revalidation rather than being
      unmounted by it.
    */
    revalidatePath("/today");
    revalidatePath("/account");
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
