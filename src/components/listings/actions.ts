"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { readPinFields } from "@/lib/map/pin";
import {
  readRevisionOutcome,
  type RevisionOutcome,
} from "@/lib/services/revision-outcome";
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
 * So nothing here returns anything resembling "Saved" for what we read. An
 * operator who submits and sees a tick will assume they are selling, and will
 * ring us on the day nobody books.
 *
 * Since D-032.3 an edit is split, though: what the operator owns (price,
 * duration, party size, where to meet, the pin) goes live at once, and only
 * what the listing promises is read first. The answer names both halves and
 * the screen renders both, see `RevisionOutcome`.
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
  /** Set once the change was sent: which half is live, which is with us. */
  outcome?: RevisionOutcome;
}

/**
 * Propose a change, or send a draft for review.
 *
 * The same endpoint does both, and the screen says two different things about
 * it — submitting a draft moves it to `in_review`, while submitting against a
 * live listing leaves it selling on the old terms until we answer.
 *
 * The body is "the fields to change, any subset of the listing", so this sends
 * only the fields the form actually carried. Sending the whole listing back
 * would turn every submission into a claim about every field, including ones
 * the operator never looked at. The form drops the fields nobody changed
 * before they reach here (`onlyChanged`).
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

  /*
    The pin (yuvoy-operator#113): both numbers, or both null to clear. The
    form sends it only when it moved, and only an API that takes pins is
    shown one (`pinsSupported`).
  */
  const pin = readPinFields(form);
  if (pin.kind === "invalid") return { message: pin.message };
  if (pin.kind === "set") {
    body.meetingLat = pin.lat;
    body.meetingLng = pin.lng;
  } else if (pin.kind === "clear") {
    body.meetingLat = null;
    body.meetingLng = null;
  }

  if (Object.keys(body).length === 0) {
    return { message: "Nothing has changed, so there is nothing to send." };
  }

  const { token } = await requireOperator();

  let outcome: RevisionOutcome;
  try {
    const { data, error } = await operatorApi(token).POST(
      "/experiences/{id}/revisions",
      { params: { path: { id } }, body },
    );
    if (error) throw error;
    outcome = readRevisionOutcome(data);
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
  return { outcome };
}
