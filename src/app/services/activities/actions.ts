"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { CATEGORIES, type Category } from "@/lib/services/vocabulary";

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
  field?: "title" | "category" | "destination" | "unitPrice";
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
const createSchema = z.object({
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
});

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
  };

  const parsed = revisionSchema.safeParse(raw);
  if (!parsed.success) {
    return { message: parsed.error.issues[0].message };
  }

  const { id, unitPrice, ...fields } = parsed.data;

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
