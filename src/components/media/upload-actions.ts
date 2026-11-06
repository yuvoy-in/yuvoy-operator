"use server";

import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { suspendedMessage } from "@/lib/account/suspended";
import { sentence } from "@/lib/format/sentence";
import { fullCeiling } from "./action-helpers";

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
  /** The file length fixed into the tus slot. */
  sizeBytes: number;
  aspectRatio?: string;
  expiresAt?: string;
}

export interface IntentState {
  intent?: UploadIntent;
  message?: string;
  /** The API refuses a second concurrent upload. */
  alreadyUploading?: boolean;
}

export async function createUploadIntent(
  sizeBytes: number,
  experienceId?: string,
  role: "hero" | "gallery" = "gallery",
): Promise<IntentState> {
  const parsedSize = z.number().int().positive().safeParse(sizeBytes);
  if (!parsedSize.success) {
    return { message: "That file is empty, so there is nothing to upload." };
  }
  const { token } = await requireOperator();

  /*
    THE LISTING, NAMED AT THE START — yuvoy-operator#31 §1.

    `experienceId` is optional on this route and required on the photograph
    one, and the asymmetry is the API's: making it mandatory here would have
    stopped every reel upload in production the moment it deployed, because
    the shipped uploader sent no listing. It becomes required once this
    portal sends it, which is what this is.

    Sending it removes the separate attach step from the ordinary flow —
    approval attaches the clip — and it gives a moderator something to judge
    `NOT_THIS_EXPERIENCE` against, which nothing recorded before.

    Optional HERE too, and that is not hedging: if an upload is already in
    flight, asking again resumes it, and a resume that named no listing must
    not be refused for it. An invalid id is dropped rather than sent, because
    a marketing-shaped field must never cost somebody a twenty-minute upload.
  */
  // Non-empty rather than a UUID shape — see `createPhotoIntent` for why a
  // client stricter than the server is a client that breaks silently.
  const listing = z
    .string()
    .min(1)
    .safeParse(experienceId ?? "");

  try {
    const { data, error } = await operatorApi(token).POST(
      "/media/upload-intents",
      {
        body: {
          sizeBytes: parsedSize.data,
          ...(listing.success ? { experienceId: listing.data, role } : {}),
        },
      },
    );
    if (error) throw error;

    if (!data.uploadUrl || !data.intentId) {
      return { message: "We could not start the upload. Try again." };
    }

    /*
      Handed to the client and never kept, on either side. "`uploadUrl` is
      never stored server-side: it is a credential for writing video into our
      account." Since yuvoy-api#66 §3 it is DERIVED from the upload's own id
      rather than remembered, which is what lets the API hand a working one
      back after a reload without ever having stored it — so the client has no
      reason to store it either, and `slot-store.ts` deliberately does not.
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
        sizeBytes: data.sizeBytes ?? parsedSize.data,
        aspectRatio: data.aspectRatio,
        expiresAt: data.expiresAt,
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was started." };
    }
    if (err instanceof OperatorApiError) {
      if (err.isNotFound) {
        /*
          A listing that is not yours answers 404, the same as one that does
          not exist — deliberately indistinguishable, so this says one thing
          and speculates about neither.
        */
        return { message: "We could not find that listing. Choose another." };
      }
      if (err.status === 409 && fullCeiling(err.details)) {
        /*
          The OTHER 409 on this route since migration 0058: that listing
          already shows as many reels as we display. Checked before the upload
          as well as at publish, because "telling somebody the gallery is full
          after a twenty-minute upload is telling them too late". Told apart
          from the slot conflict by whether the details name a ceiling.
        */
        const full = fullCeiling(err.details)!;
        return {
          message: `That listing already shows ${full.limit} ${full.noun}. Remove one first. Your ${full.other} are not affected.`,
        };
      }
      if (err.status === 409) {
        /*
          Kept, and reworded, because it is still declared in the contract while
          meaning something much narrower than it used to.

          Since yuvoy-api#66 §3 your OWN upload in flight comes back instead of
          being refused, so this can no longer be the operator's own stranded
          tab. What is left is somebody else holding the slot — a colleague, if
          the quota is per operator rather than per user, which is the one thing
          on that issue still unanswered. The copy is true under either reading
          and promises nothing about a URL that can no longer be lost.
        */
        return {
          alreadyUploading: true,
          message:
            "An upload is already going for this business, started somewhere else. Yours will go once that one finishes or times out.",
        };
      }
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
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
            "Uploads are switched off for now: nothing to do with your clip. We will tell you when they open.",
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
  /**
   * The answer will not change, so the upload is over: the host refused the
   * clip (`422 media_refused`) or has nothing under this upload (`404`).
   * "Asking again gives the same answer", so the caller stops polling and
   * lets the slot go, and the next clip asks for a new one.
   */
  final?: boolean;
}

/**
 * Tell the API the bytes are up.
 *
 * "A hint that it is worth polling, nothing more — the client's claim is never
 * trusted." `202 ready:false` is the normal first answer and is not an error;
 * the caller polls.
 *
 * Two answers are final (yuvoy-api#286). A clip the video host will never make
 * (not a video, longer than the slot allowed, one it could not decode) answers
 * `422 media_refused`, whose message "is a sentence to show as it is". It fell
 * to "Try again shortly" before, for a clip no retry could ever bring back
 * (yuvoy-operator#157). `details.reason` is a code for support, "not a closed
 * list to branch on", and nothing here reads it. A `404` is the host having
 * nothing under this upload, which asking again cannot change either.
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
      return { message: "No signal. The upload is safe. Try again shortly." };
    }
    if (err instanceof OperatorApiError && err.code === "media_refused") {
      return {
        message:
          sentence(err.message) ||
          "That clip was refused, so it will not be in your reels. Choose another.",
        final: true,
      };
    }
    if (err instanceof OperatorApiError && err.isNotFound) {
      return {
        message: "That upload is no longer here. Start again.",
        final: true,
      };
    }
    return { message: "We could not check the upload. Try again shortly." };
  }
}
