"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import {
  ENTITY_TYPES,
  gstinIssue,
  type EntityType,
} from "@/lib/profile/details";
import {
  CREDENTIAL_TYPES,
  expiryIssue,
  type CredentialType,
} from "@/lib/profile/credentials";
import { marketDate } from "@/lib/format/market-time";

/**
 * O6's writes — the business behind the account, and the documents we hold.
 *
 * Every one of these exists so an operator can act on a blocker `/account`
 * already names. "Until it existed the screen named a blocker and then asked
 * them to ring us."
 *
 * ## No role gate on any of them
 *
 * `PUT /profile`, `POST /credentials` and `PUT /logo` each declare a generic
 * `Forbidden` and name no role. Inventing one would tell a manager they may
 * not send us an insurance certificate the server would have accepted, which
 * is the direction that costs an operator a week.
 */

/* -------------------------------------------------------------- details -- */

export interface DetailsState {
  message?: string;
  field?: string;
  saved?: boolean;
}

const detailsSchema = z.object({
  legalName: z
    .string()
    .trim()
    .min(2, "The name the business is registered under."),
  entityType: z.enum(
    ENTITY_TYPES.map((e) => e.value) as unknown as [
      EntityType,
      ...EntityType[],
    ],
  ),
  /*
    Optional, and validated only for length when supplied. "Plenty of island
    operators are under the registration threshold, and demanding a number they
    cannot legally obtain would block exactly the businesses this marketplace
    exists for."
  */
  gstin: z.string().trim().optional(),
  addressLine1: z.string().trim().min(1, "The street or the building."),
  addressLine2: z.string().trim().optional(),
  locality: z.string().trim().min(1, "The town or village."),
  region: z.string().trim().min(1, "The state or union territory."),
  postalCode: z.string().trim().min(1, "The PIN code."),
  country: z.string().trim().optional(),
});

export async function saveDetails(
  _prev: DetailsState,
  form: FormData,
): Promise<DetailsState> {
  const raw = Object.fromEntries(
    [
      "legalName",
      "entityType",
      "gstin",
      "addressLine1",
      "addressLine2",
      "locality",
      "region",
      "postalCode",
      "country",
    ].map((k) => [k, String(form.get(k) ?? "")]),
  );

  const parsed = detailsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { field: String(issue.path[0] ?? ""), message: issue.message };
  }

  const gstProblem = gstinIssue(parsed.data.gstin ?? "");
  if (gstProblem) return { field: "gstin", message: gstProblem };

  const { token } = await requireOperator();

  try {
    /*
      A whole document, not a patch. "This is one form filled in during
      onboarding, and partial writes would leave it half-saved in ways the
      completeness check then has to reason about."

      An empty optional is omitted rather than sent as "": absence is what the
      contract means by optional, and an empty GSTIN string is a claim to be
      registered with no number.
    */
    const { error } = await operatorApi(token).PUT("/profile", {
      body: {
        legalName: parsed.data.legalName,
        entityType: parsed.data.entityType,
        ...(parsed.data.gstin ? { gstin: parsed.data.gstin } : {}),
        addressLine1: parsed.data.addressLine1,
        ...(parsed.data.addressLine2
          ? { addressLine2: parsed.data.addressLine2 }
          : {}),
        locality: parsed.data.locality,
        region: parsed.data.region,
        postalCode: parsed.data.postalCode,
        ...(parsed.data.country ? { country: parsed.data.country } : {}),
      },
    });
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was saved — try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "details_locked" || err.status === 409) {
        /*
          The account went LIVE between the render and the tap. Not an error to
          apologise for — the details ARE right, they are simply not ours to
          change any more, and the reason is the whole point of the lock.
        */
        return {
          message:
            "Your account is live now, so these are locked — the documents we verified were checked against them. Message us to change anything here.",
        };
      }
      if (err.status === 400 && err.message) return { message: err.message };
      if (err.status === 403) {
        return { message: "You cannot change the business details." };
      }
    }
    return { message: "It was not saved. Try again." };
  }

  /*
    Revalidate: `missing` shrinks, `editable` may flip, and `/account`'s
    blockers are derived from the same read. The list becoming right is a
    better confirmation than a sentence — but a sentence goes with it here,
    because the thing that changed is spread across two screens and neither
    shows a diff.
  */
  revalidatePath("/profile");
  revalidatePath("/account");
  return { saved: true };
}

/* ---------------------------------------------------------- credentials -- */

export interface CredentialState {
  message?: string;
  field?: string;
  /** Set when the document is with us. Never "verified". */
  sent?: { type: string };
}

const credentialSchema = z.object({
  type: z.enum(
    CREDENTIAL_TYPES.map((c) => c.value) as unknown as [
      CredentialType,
      ...CredentialType[],
    ],
  ),
  issuer: z.string().trim().optional(),
  identifier: z.string().trim().optional(),
  issuedOn: z.string().trim().optional(),
  expiresOn: z.string().trim().optional(),
  notes: z.string().trim().max(1000).optional(),
});

/**
 * File a document.
 *
 * Nothing here can verify anything, and the screen says so: "verification is
 * somebody at Yuvoy looking at the document, and a self-service path to
 * `verified` would make the credential gate decorative."
 */
export async function fileCredential(
  _prev: CredentialState,
  form: FormData,
): Promise<CredentialState> {
  const parsed = credentialSchema.safeParse({
    type: String(form.get("type") ?? ""),
    issuer: String(form.get("issuer") ?? ""),
    identifier: String(form.get("identifier") ?? ""),
    issuedOn: String(form.get("issuedOn") ?? ""),
    expiresOn: String(form.get("expiresOn") ?? ""),
    notes: String(form.get("notes") ?? ""),
  });
  if (!parsed.success) {
    return { message: "Choose which document this is." };
  }

  /*
    The one date check worth doing on this side: a year typed wrong. Filing an
    already-expired document REPLACES the pending one — "sending the same kind
    twice replaces the earlier pending one rather than stacking beside it" — so
    the mistake costs a document that was already in the queue.

    The market's day, not the device's, for the same reason every other date in
    this portal is.
  */
  const today = marketDate(new Date());
  const dateProblem = expiryIssue(parsed.data.expiresOn ?? "", today);
  if (dateProblem) return { field: "expiresOn", message: dateProblem };

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).POST("/credentials", {
      body: {
        type: parsed.data.type,
        ...(parsed.data.issuer ? { issuer: parsed.data.issuer } : {}),
        ...(parsed.data.identifier
          ? { identifier: parsed.data.identifier }
          : {}),
        ...(parsed.data.issuedOn ? { issuedOn: parsed.data.issuedOn } : {}),
        ...(parsed.data.expiresOn ? { expiresOn: parsed.data.expiresOn } : {}),
        ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      },
    });
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return {
        message: "No signal. Nothing was sent — we have not got it yet.",
      };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 409) {
        return {
          message:
            "We already hold a verified copy of that one. Message us if it needs replacing.",
        };
      }
      if (err.status === 400 && err.message) return { message: err.message };
    }
    return { message: "It was not sent. Try again." };
  }

  revalidatePath("/profile");
  revalidatePath("/account");
  return { sent: { type: parsed.data.type } };
}
