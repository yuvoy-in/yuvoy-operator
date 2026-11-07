"use server";

import { revalidatePath } from "next/cache";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import {
  claimFailure,
  type ClaimFailure,
  type ListingClaim,
} from "@/lib/claims/claims";
import { CLAIM_CODE, PROOF_OPTIONS } from "@/lib/claims/words";

/**
 * The three writes of a listing claim (yuvoy-operator#388): the claim itself,
 * a code to an address at the listing's website, and that code checked.
 *
 * Each turns its own failure into `claimFailure`, the API's sentence and what
 * the screen does next. The role is the API's to refuse (`403 forbidden`,
 * shown in its words): the screen offers the claim to an OWNER or ADMIN only,
 * and a forced one still meets the server's gate, never one of ours.
 *
 * The claims list on Verification is revalidated after every write that
 * changes it, so "See your claims under Verification" finds the new claim.
 */

const VERIFICATION = "/account/verification";

export type CreateClaimState = Partial<ClaimFailure> & {
  claim?: ListingClaim;
};

export async function createClaim(
  _prev: CreateClaimState,
  form: FormData,
): Promise<CreateClaimState> {
  const slug = String(form.get("slug") ?? "").trim();
  const method = PROOF_OPTIONS.find(
    (o) => o.method === form.get("proofMethod"),
  )?.method;
  if (!slug) return { message: "There is no listing to claim here." };
  if (!method) return { message: "Choose how to show it is yours." };

  const { token } = await requireOperator();
  try {
    const { data, error } = await operatorApi(token).POST("/listing-claims", {
      body: { supplierSlug: slug, proofMethod: method },
    });
    if (error) throw error;
    revalidatePath(VERIFICATION);
    return { claim: data };
  } catch (err) {
    return claimFailure(err, "create");
  }
}

export type EmailStepState = Partial<ClaimFailure> & { done?: boolean };

export async function sendClaimCode(
  _prev: EmailStepState,
  form: FormData,
): Promise<EmailStepState> {
  const id = String(form.get("claimId") ?? "");
  const email = String(form.get("email") ?? "").trim();
  if (!id) return { message: "There is no such claim." };

  const { token } = await requireOperator();
  try {
    const { error } = await operatorApi(token).POST(
      "/listing-claims/{id}/email-code",
      { params: { path: { id } }, body: { email } },
    );
    if (error) throw error;
    return { done: true };
  } catch (err) {
    return refused(claimFailure(err, "send"));
  }
}

export async function checkClaimCode(
  _prev: EmailStepState,
  form: FormData,
): Promise<EmailStepState> {
  const id = String(form.get("claimId") ?? "");
  const code = String(form.get("code") ?? "").trim();
  if (!id) return { message: "There is no such claim." };
  if (!CLAIM_CODE.test(code)) return { message: "Enter the six digits." };

  const { token } = await requireOperator();
  try {
    const { error } = await operatorApi(token).POST(
      "/listing-claims/{id}/email-code/verify",
      { params: { path: { id } }, body: { code } },
    );
    if (error) throw error;
    revalidatePath(VERIFICATION);
    return { done: true };
  } catch (err) {
    return refused(claimFailure(err, "check"));
  }
}

/** A claim decided or withdrawn under the screen: the list is read again. */
function refused(failure: ClaimFailure): EmailStepState {
  if (failure.readAgain) revalidatePath(VERIFICATION);
  return failure;
}
