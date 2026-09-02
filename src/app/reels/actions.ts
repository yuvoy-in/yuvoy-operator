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

/**
 * O8's three writes. The fourth step — the bytes — does not happen here.
 *
 * "Bytes never pass through this API": the browser uploads straight to the
 * video provider over tus. So this file brokers the credential and reports the
 * outcome, and the upload itself is the one thing in this portal that is a
 * client-side network call. That is not a hole in the architecture — the
 * session never goes near it, and the upload URL is a one-shot write
 * credential for a bucket, not a key to the operator API.
 */

export interface UploadIntent {
  intentId: string;
  uploadUrl: string;
  chunkBytes: number;
  maxBytes: number;
  maxSeconds: number;
  aspectRatio?: string;
  expiresAt?: string;
}

export interface IntentState {
  intent?: UploadIntent;
  message?: string;
  /** The API refuses a second concurrent upload. */
  alreadyUploading?: boolean;
}

export async function createUploadIntent(): Promise<IntentState> {
  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/media/upload-intents",
      {},
    );
    if (error) throw error;

    if (!data.uploadUrl || !data.intentId) {
      return { message: "We could not start the upload. Try again." };
    }

    /*
      Handed to the client and never kept. "Returned once and never stored
      server-side: it is a credential for writing video into our account."
      Nothing here logs it, and `safePath` already strips query strings before
      any URL reaches a logger.
    */
    return {
      intent: {
        intentId: data.intentId,
        uploadUrl: data.uploadUrl,
        // The server decides the chunk size. A client with its own idea of it
        // is a client that breaks the day the provider changes.
        chunkBytes: data.chunkBytes ?? 5 * 1024 * 1024,
        maxBytes: data.maxBytes ?? 200 * 1024 * 1024,
        maxSeconds: data.maxSeconds ?? 60,
        aspectRatio: data.aspectRatio,
        expiresAt: data.expiresAt,
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was started." };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 409) {
        /*
          One at a time, and this is the message that has to carry the whole
          awkward truth: the earlier upload cannot be resumed either, because
          its URL was never persisted anywhere. Saying "try again later" would
          leave somebody refreshing for an hour.
        */
        return {
          alreadyUploading: true,
          message:
            "An upload is already going for this business. If it was you and the tab closed, it cannot be picked up again — wait for it to time out, or ask us to clear it.",
        };
      }
      if (err.status === 403) {
        return { message: "Your role cannot upload footage." };
      }
      if (err.code === "media_unavailable") {
        /*
          The brief's "you will see this today": no Cloudflare Stream account
          exists yet (yuvoy-api#64), so production refuses every upload with
          this code. It is nothing to do with the clip and nothing a retry
          fixes, so it is said as such rather than as a generic failure.
        */
        return {
          message:
            "Uploads are switched off for now — nothing to do with your clip. We will tell you when they open.",
        };
      }
    }
    return { message: "We could not start the upload. Try again." };
  }
}

export interface ConfirmState {
  ready?: boolean;
  mediaAssetId?: string;
  message?: string;
}

/**
 * Tell the API the bytes are up.
 *
 * "A hint that it is worth polling, nothing more — the client's claim is never
 * trusted." `202 ready:false` is the normal first answer and is not an error;
 * the caller polls.
 */
export async function confirmUpload(intentId: string): Promise<ConfirmState> {
  const { token } = await requireOperator();
  const parsed = z.string().min(1).safeParse(intentId);
  if (!parsed.success) return { message: "Nothing to confirm." };

  try {
    const { data, error } = await operatorApi(token).POST(
      "/media/upload-intents/{id}/complete",
      { params: { path: { id: parsed.data } } },
    );
    if (error) throw error;

    const ready = data.ready === true;
    return {
      ready,
      mediaAssetId: ready
        ? (data as { mediaAssetId?: string }).mediaAssetId
        : undefined,
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. The upload is safe — try again shortly." };
    }
    if (err instanceof OperatorApiError && err.isNotFound) {
      return { message: "That upload is no longer here. Start again." };
    }
    return { message: "We could not check the upload. Try again shortly." };
  }
}

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
      No `revalidatePath`. There is nothing on this page the server could
      re-render that says more than this does — `GET /media` does not exist, so
      the list a revalidation would refresh is a list we cannot fetch. The
      returned note is the only record of what just happened.
    */
    return { done: { note: data.note } };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was recorded — try again." };
    }
    if (err instanceof OperatorApiError) {
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
 * Reachable for the clip the operator has **just** submitted, and only that
 * one, because `GET /media` does not exist and the id is otherwise
 * unrecoverable the moment this page unmounts. That is a real limitation and
 * the screen says so — but the case it does cover is the common one: the wrong
 * file, noticed immediately.
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
    return { withdrawn: { note: data.note } };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. It is still up — try again." };
    }
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
