"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { CATEGORIES, type Category } from "@/lib/services/vocabulary";
import { WITHDRAW_REASONS, type WithdrawReason } from "@/lib/services/listings";

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

export interface CreateState {
  message?: string;
  field?:
    | "title"
    | "category"
    | "destination"
    | "unitPrice"
    | "pricingUnit"
    | "durationMinutes"
    | "maxPartySize"
    | "activityType";
  /** Set when the draft exists, so the screen can say what it is NOT. */
  created?: { id: string; title: string };
}

/**
 * Only the three the contract requires, plus a price.
 *
 * Everything else has "a default chosen so a minimal form produces something
 * sellable — party size 6, `per_person`, `request` mode, 120 minutes", and a
 * form that re-asked all of it would be a wall between an operator and their
 * first listing. The rest is edited afterwards, through review, which is where
 * those fields belong anyway: they are material changes.
 */
const createSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(3, "What is it called? A traveller will read this first."),
    /*
    The enum, not free text. `category` is "closed and enforced by a database
    constraint, so a value outside this set is a 400" — and the generated type
    now says so, which is how the re-pin caught the old text box the moment the
    enum landed.
  */
    category: z.enum(CATEGORIES as unknown as [Category, ...Category[]], {
      message: "Choose what kind of thing this is.",
    }),
    destination: z.string().trim().min(1, "Where does it run?"),
    /*
      Optional on create and mandatory to PUBLISH — it appears in
      `publishBlockers` until set, so refusing it here would block a first
      draft over something the operator can finish later. Not an enum: the set
      grows by INSERT and is narrowed per market, so the server is the only
      authority on which values pair with which category.
    */
    activityType: z
      .string()
      .trim()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /*
    Optional, and the form says what leaving it out costs rather than refusing
    it: "a listing without `unitPricePaise` can be saved but cannot be
    approved, which the response reports as `sellable: false`". An operator
    should learn that while writing rather than after waiting for a review.
  */
    unitPrice: z
      .string()
      .trim()
      .transform((v) => v.replace(/[,\s₹]/g, ""))
      .pipe(z.string().regex(/^\d*$/, "A price in whole rupees, digits only.")),
    /*
    Optional here and REQUIRED the moment a price is given — see the refine
    below. `pricingUnit` describes a price, so asking "per person or for the
    group?" about a price that does not exist yet is a forced choice about
    nothing.
  */
    pricingUnit: z
      .enum(["per_person", "per_group"])
      .optional()
      .or(z.literal("").transform(() => undefined)),
    /*
      Duration and party size — yuvoy-operator#30 §5.

      Both DEFAULT server-side (120 minutes, 6 people) and were settable
      nowhere, so "every listing ships as two hours and six people". That is
      not a harmless default: duration is rendered on the traveller's card, so
      a two-hour claim about a full-day charter is the same class of
      misstatement as the pricing basis above.

      Optional rather than required — an operator writing a first draft should
      not be blocked on it — but sent whenever given, so the server's default
      only survives when nobody has said otherwise.
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
  })
  .refine((v) => !v.unitPrice || v.pricingUnit !== undefined, {
    path: ["pricingUnit"],
    /*
    Refused rather than defaulted. The API stopped defaulting `pricingUnit`
    precisely so an unanswered listing is recorded as unstated (yuvoy-api
    migration 0056), and a form that quietly sent `per_person` would defeat the
    change it exists for — with a consumer pricing misstatement as the result.
  */
    message: "Say whether that price is per person or for the whole group.",
  });

export async function createListing(
  _prev: CreateState,
  form: FormData,
): Promise<CreateState> {
  const parsed = createSchema.safeParse({
    title: String(form.get("title") ?? ""),
    category: String(form.get("category") ?? ""),
    destination: String(form.get("destination") ?? ""),
    unitPrice: String(form.get("unitPrice") ?? ""),
    pricingUnit: String(form.get("pricingUnit") ?? ""),
    activityType: String(form.get("activityType") ?? ""),
    durationMinutes: String(form.get("durationMinutes") ?? ""),
    maxPartySize: String(form.get("maxPartySize") ?? ""),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      field: issue.path[0] as CreateState["field"],
      message: issue.message,
    };
  }

  const { token } = await requireOperator();
  const rupees = parsed.data.unitPrice;

  try {
    const { data, error } = await operatorApi(token).POST("/experiences", {
      body: {
        title: parsed.data.title,
        category: parsed.data.category,
        destination: parsed.data.destination,
        // Paise, because the contract counts in paise. Rupees on the form,
        // because nobody prices a dive in paise.
        ...(rupees ? { unitPricePaise: Number(rupees) * 100 } : {}),
        // Sent only when the operator actually said. Never defaulted.
        ...(parsed.data.pricingUnit
          ? { pricingUnit: parsed.data.pricingUnit }
          : {}),
        ...(parsed.data.activityType
          ? { activityType: parsed.data.activityType }
          : {}),
        ...(parsed.data.durationMinutes
          ? { durationMinutes: Number(parsed.data.durationMinutes) }
          : {}),
        ...(parsed.data.maxPartySize
          ? { maxPartySize: Number(parsed.data.maxPartySize) }
          : {}),
      },
    });
    if (error) throw error;

    /*
      Revalidate AND return the id. The list is the confirmation — the draft
      appears on it with its own state — and the id is what the screen uses to
      scroll to it and offer the next act, which is sending it for review.
    */
    revalidatePath("/services/activities");
    return { created: { id: data.id ?? "", title: parsed.data.title } };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was saved — try again." };
    }
    if (err instanceof OperatorApiError) {
      /*
        413, from the API's 64K body limit — yuvoy-operator#30 §7.

        Genuinely reachable on this form now that inclusions, requirements and
        safety notes are free text: an operator pasting a whole safety briefing
        gets here. The refusal must NOT offer a retry — an identical body fails
        identically, so "try again" is a loop that costs island signal and
        reaches nothing.
      */
      if (err.code === "payload_too_large") {
        return {
          message:
            "That is more text than we can accept in one go. Shorten the longest box — the lists and the safety notes are the usual culprits — and send it again.",
        };
      }
      if (err.status === 409) {
        return {
          message:
            "There is already a listing at that web address. Change the title slightly and try again.",
        };
      }
      if (err.status === 400) {
        /*
          The API's own sentence. The most likely 400 here is a destination
          belonging to another market — "one belonging to another market is
          refused" — and the server knows which markets exist while this portal
          has no way to list them (raised on yuvoy-api). Paraphrasing would
          drop the only specific thing anybody has to go on.
        */
        return { message: err.message || "Check the details and try again." };
      }
      if (err.status === 403) {
        return {
          message: "This account cannot add listings yet. Message us.",
        };
      }
    }
    return { message: "It was not saved. Try again." };
  }
}

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
      return { message: "No signal. Nothing was sent — try again." };
    }
    if (err instanceof OperatorApiError && err.code === "payload_too_large") {
      // See the create action above. No retry: the same body fails the same.
      return {
        message:
          "That is more text than we can accept in one go. Shorten the longest box — the lists and the safety notes are the usual culprits — and send it again.",
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
      if (err.status === 403) {
        return { message: "You cannot change listings on this account." };
      }
    }
    return { message: "It was not sent. Try again." };
  }

  // The listing's own state changes — `draft` becomes `in_review`, `live`
  // becomes `live_changes_in_review` — so the list says more than a message.
  revalidatePath("/services/activities");
  return { submitted: true };
}

export interface WithdrawState {
  message?: string;
  /**
   * What was typed, handed back so a refusal does not empty the form. See the
   * note in `withdrawListing`.
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
  };
}

const withdrawSchema = z.object({
  id: z.string().min(1),
  reasonCode: z.enum(
    WITHDRAW_REASONS.map((r) => r.code) as [
      WithdrawReason,
      ...WithdrawReason[],
    ],
  ),
  note: z.string().trim().optional(),
  confirmExperienceId: z.string().trim().min(1),
});

/**
 * Taking your own listing off sale — yuvoy-operator#30 §6.
 *
 * ## It cancels nothing, and the screen says so twice
 *
 * "This cancels nothing and refunds nothing. Future departures keep their rows
 * and simply stop being offered; confirmed bookings are untouched and you still
 * owe those travellers the trip." An operator who assumes otherwise **will not
 * turn up**, which is the single worst outcome this action can produce — so the
 * form says it before, and the API's own `note` says it after, verbatim.
 *
 * ## Confirmed by typing the id, not by a checkbox
 *
 * The contract's reason, and it is the same call the departure call-off makes:
 * "a checkbox is one mis-tap on a wet phone away from taking a live listing off
 * sale". The comparison happens here as well as at the API, because a Server
 * Action is a public POST endpoint whatever the form does.
 */
export async function withdrawListing(
  _prev: WithdrawState,
  form: FormData,
): Promise<WithdrawState> {
  const parsed = withdrawSchema.safeParse({
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
  const again = (message: string): WithdrawState => ({
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
      "Your role cannot take a listing off sale. An owner or manager has to.",
    );
  }

  try {
    const { data, error } = await operatorApi(token).POST(
      "/experiences/{id}/withdraw",
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
    revalidatePath("/services/activities");
    return {
      done: {
        upcomingDepartures: data.upcomingDepartures,
        bookingsToHonour: data.bookingsToHonour,
        guestsToHonour: data.guestsToHonour,
        note: data.note,
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return again("No signal. Nothing was sent — it is still on sale.");
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "already_off_sale") {
        return again("This one is already off sale.");
      }
      if (err.code === "cannot_withdraw") {
        return again(
          "This listing cannot be taken off sale from here. Message us and a person will do it.",
        );
      }
      if (err.status === 403) {
        return again(
          "Your role cannot take a listing off sale. An owner or manager has to.",
        );
      }
    }
    return again("Could not take it off sale. Nothing changed.");
  }
}
