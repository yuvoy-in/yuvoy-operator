"use server";

import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import {
  RIGHTS_TYPES,
  WITHDRAW_REASONS,
  rightsProblem,
  type RightsType,
  type WithdrawReason,
} from "@/lib/media/rights";
import { suspendedMessage } from "@/lib/account/suspended";
import { dedashText } from "@/lib/format/dedash";

/*
  Rights and withdrawal, moved from actions.ts so no file runs past 500
  lines (yuvoy-operator#178).
*/

export interface AttestState {
  message?: string;
  field?: string;
  done?: { note?: string };
}

const attestSchema = z.object({
  mediaAssetId: z.string().min(1),
  statementVersion: z.number().int().min(1),
  statementSha256: z.string().regex(/^[a-f0-9]{64}$/),
  rightsType: z.enum(
    RIGHTS_TYPES.map((r) => r.code) as [RightsType, ...RightsType[]],
  ),
  /*
    Coerced from the form's THREE states, never two. An absent radio is
    `undefined` here and fails the schema, which is the point: "must be an
    explicit true or false, never defaulted and never omitted".
  */
  peopleConsentConfirmed: z.boolean(),
  thirdPartyRef: z.string().trim().optional(),
  licenceRef: z.string().trim().optional(),
  filmedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  filmedAtLocation: z.string().trim().optional(),
});

export async function attestRights(
  _prev: AttestState,
  form: FormData,
): Promise<AttestState> {
  const consentRaw = form.get("peopleConsentConfirmed");
  const parsed = attestSchema.safeParse({
    mediaAssetId: String(form.get("mediaAssetId") ?? ""),
    statementVersion: Number(form.get("statementVersion") ?? 0),
    statementSha256: String(form.get("statementSha256") ?? ""),
    rightsType: String(form.get("rightsType") ?? ""),
    peopleConsentConfirmed:
      consentRaw === "yes" ? true : consentRaw === "no" ? false : undefined,
    thirdPartyRef: form.get("thirdPartyRef")
      ? String(form.get("thirdPartyRef"))
      : undefined,
    licenceRef: form.get("licenceRef")
      ? String(form.get("licenceRef"))
      : undefined,
    filmedOn: form.get("filmedOn") ? String(form.get("filmedOn")) : undefined,
    filmedAtLocation: form.get("filmedAtLocation")
      ? String(form.get("filmedAtLocation"))
      : undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      field: String(issue.path[0] ?? ""),
      message:
        issue.path[0] === "peopleConsentConfirmed"
          ? "Answer the question about the people in the clip. There is no default."
          : "Something in the form was not right. Check it and try again.",
    };
  }

  const { mediaAssetId, ...body } = parsed.data;

  /*
    The same rule the form applies, applied here. "Licensed" needs the
    licence, "somebody gave us permission" needs who — the form marks those
    fields `required`, and a Server Action is a public POST endpoint that
    never sees the form. `rightsProblem()` existed for exactly this and was
    never called.
  */
  const problem = rightsProblem({
    rightsType: body.rightsType,
    peopleConsentConfirmed: body.peopleConsentConfirmed,
    licenceRef: body.licenceRef,
    thirdPartyRef: body.thirdPartyRef,
  });
  if (problem) return { field: problem.field, message: problem.message };

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/media/{id}/rights",
      {
        params: { path: { id: mediaAssetId } },
        body,
      },
    );
    if (error) throw error;

    /*
      NOT revalidated here. Every one of these is called from the reel sheet on
      `/account`, and revalidating that route unmounts the sheet and the receipt
      inside it before the operator has read either — the rule this repo learned
      at #43 and twice at #45. The grid refreshes when the sheet closes.
    */
    return { done: { note: dedashText(data.note) } };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was recorded. Try again." };
    }
    if (err instanceof OperatorApiError) {
      /*
        A suspended business is refused with 403 `account_suspended`, which is
        the one 403 this endpoint declares. It fell through to "Nothing was
        recorded. Try again" (yuvoy-operator#90 f13), sending the operator to
        retry something that can never succeed and hiding why.
      */
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.isNotFound) {
        return { message: "That clip is no longer here. Start again." };
      }
      if (err.status === 400) return { message: err.message };
    }
    return { message: "Nothing was recorded. Try again." };
  }
}

/* -------------------------------------------------------------- withdraw -- */

export interface WithdrawState {
  message?: string;
  withdrawn?: { note?: string };
}

const withdrawSchema = z.object({
  mediaAssetId: z.string().min(1),
  reason: z.enum(
    WITHDRAW_REASONS.map((r) => r.code) as [
      WithdrawReason,
      ...WithdrawReason[],
    ],
  ),
});

/**
 * Take a clip down.
 *
 * The submission receipt covers the common case: the wrong file, noticed
 * immediately. The library now keeps the clip visible after this component
 * unmounts, so withdrawal can also be offered there independently.
 *
 * "Two acts that fail independently, and only the first is transactional: it
 * comes off Yuvoy immediately, and the original is deleted at the video
 * provider shortly afterwards by a job." So a success here means it is off
 * Yuvoy, which is the half the operator asked for — and the copy does not
 * promise the provider deletion that has not happened yet.
 */
export async function withdrawMedia(
  _prev: WithdrawState,
  form: FormData,
): Promise<WithdrawState> {
  const parsed = withdrawSchema.safeParse({
    mediaAssetId: String(form.get("mediaAssetId") ?? ""),
    reason: String(form.get("reason") ?? ""),
  });
  if (!parsed.success) {
    return { message: "Choose why it is coming down." };
  }

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/media/{id}/withdraw",
      {
        params: { path: { id: parsed.data.mediaAssetId } },
        body: { reason: parsed.data.reason },
      },
    );
    if (error) throw error;
    /*
      NOT revalidated here. Every one of these is called from the reel sheet on
      `/account`, and revalidating that route unmounts the sheet and the receipt
      inside it before the operator has read either — the rule this repo learned
      at #43 and twice at #45. The grid refreshes when the sheet closes.
    */
    // Not `/account`: see `attachMedia`. The note below is the receipt.
    return { withdrawn: { note: dedashText(data.note) } };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. It is still up. Try again." };
    }
    /*
      Suspension first, before anything that reads as retryable. Taking a clip
      down is not one of the writes a suspended business may still make, and
      the refusal read "It was not taken down. Try again" (yuvoy-operator#90
      f13), a retry that can never succeed.
    */
    const refusal = suspendedMessage(err);
    if (refusal) return { message: refusal };
    if (err instanceof OperatorApiError && err.isNotFound) {
      /*
        404 and another operator's clip are one case; the server does not
        distinguish them and neither does this. For a clip we just created,
        the realistic cause is that it is already gone.
      */
      return {
        message: "That clip is not here any more. It may already be down.",
      };
    }
    return { message: "It was not taken down. Try again." };
  }
}
