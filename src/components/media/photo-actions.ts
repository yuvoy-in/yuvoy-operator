"use server";

import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { suspendedMessage } from "@/lib/account/suspended";
import { fullCeiling } from "./action-helpers";

/*
  Photographs, moved from actions.ts so no file runs past 500 lines
  (yuvoy-operator#178).
*/

/* ---------------------------------------------------------- photographs -- */

export interface PhotoIntent {
  imageId: string;
  uploadUrl: string;
  maxBytes: number;
  expiresAt?: string;
  /**
   * The row recording which listing this upload is for. Sent back to
   * `/photo-intents/complete`, which is what carries the listing across the
   * upload — `imageId` alone does not name one.
   */
  intentId?: string;
}

export interface PhotoIntentState {
  intent?: PhotoIntent;
  message?: string;
  /** Image hosting is off on this deployment. Not retryable by the operator. */
  unavailable?: boolean;
}

/**
 * A slot to upload a photograph into — yuvoy-operator#27.
 *
 * ## Why this is a separate action from the clip's
 *
 * Different host, different limits, no tus, and — the one that matters — **no
 * single-slot quota**. A clip intent is one per operator and answers `409`
 * while another is open; the photograph endpoint declares no such refusal, so
 * an operator adding a row of photographs is not fighting their own uploads.
 * Sharing one action would have meant carrying the clip's slot machinery into
 * a flow that does not have a slot.
 *
 * From `complete` onward the two converge completely: same attestation, same
 * review queue, same publish. "There is no shorter path, deliberately."
 */
export async function createPhotoIntent(
  experienceId: string,
  role: "hero" | "gallery" = "gallery",
): Promise<PhotoIntentState> {
  /*
    `experienceId` is REQUIRED here, unlike the clip route — migration 0058,
    and deliberate: nothing called this endpoint, so there was no deployed
    client to break and a photograph starts life the way both should end it.
    Refused before a slot is asked for; a 400 from the API would say the same
    thing thirty seconds later and after a round trip.
  */
  /*
    Non-empty, NOT a UUID shape.

    The contract types `experienceId` as `format: uuid`, and validating that
    here was wrong in the one direction that matters: the id comes from OUR
    OWN `GET /experiences` list, so refusing it client-side is refusing
    something the server just handed us. The server is the authority on the
    format and answers 404 for an id it does not know — a client stricter than
    the server breaks the day ids change shape, and breaks silently, on the
    screen an operator is trying to use.
  */
  const parsed = z.string().min(1).safeParse(experienceId);
  if (!parsed.success) {
    return { message: "Choose the listing this photograph belongs to." };
  }
  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/media/photo-intents",
      { body: { experienceId: parsed.data, role } },
    );
    if (error) throw error;

    if (!data.imageId || !data.uploadUrl) {
      return { message: "We could not start the upload. Try again." };
    }

    return {
      intent: {
        imageId: data.imageId,
        uploadUrl: data.uploadUrl,
        /*
          The server's ceiling, read rather than hardcoded. Ours is smaller
          than the host's on purpose — "a 10 MB photograph on a listing costs
          the traveller the download on island 4G" — and a change there must
          not need a deploy here.
        */
        maxBytes: data.maxBytes ?? 5 * 1024 * 1024,
        expiresAt: data.expiresAt,
        intentId: data.intentId,
      },
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was started." };
    }
    if (err instanceof OperatorApiError) {
      // A suspended business is refused with 403 too, and the role
      // sentence would be the wrong one. See `suspendedMessage`.
      const refusal = suspendedMessage(err);
      if (refusal) return { message: refusal };
      if (err.status === 403) {
        return { message: "Your role cannot upload photographs." };
      }
      if (err.isNotFound) {
        /*
          "A listing that is not yours answers 404, indistinguishable from one
          that does not exist." One message for both, because telling somebody
          that listing exists but is not theirs confirms it exists.
        */
        return { message: "We could not find that listing. Choose another." };
      }
      if (err.status === 409) {
        /*
          The gallery is full. Refused HERE rather than after the upload —
          "telling somebody the gallery is full after twenty minutes on a
          0.5 Mbps uplink is telling them too late" — and the ceilings are
          separate per kind, so a full photo gallery never blocks a reel.
        */
        const full = fullCeiling(err.details);
        return {
          message: full
            ? `That listing already shows ${full.limit} ${full.noun}. Remove one first. Your ${full.other} are not affected.`
            : "That listing already shows as many photographs as we display.",
        };
      }
      if (err.status === 400) {
        return { message: "Choose the listing this photograph belongs to." };
      }
      if (err.status === 503) {
        /*
          "Image hosting is not configured on this service." Not the
          operator's problem and not something a retry fixes, so it is said as
          a state rather than as a failure they should try again.
        */
        return {
          unavailable: true,
          message:
            "Photographs are switched off for now: nothing to do with your picture. We will tell you when they open.",
        };
      }
      if (err.status === 502) {
        // "The image host could not mint a slot. Retry safely."
        return { message: "The picture host did not answer. Try again." };
      }
    }
    return { message: "We could not start the upload. Try again." };
  }
}

export interface PhotoCompleteState {
  mediaAssetId?: string;
  message?: string;
}

/**
 * Confirm the photograph arrived — and it is the HOST that is asked, not us.
 *
 * "The host is asked whether the file arrived and who it belongs to; the client
 * is not believed about either." So a browser that says it finished cannot
 * produce a media asset out of nothing, which is the same property `complete`
 * has on the video side.
 *
 * The two failures worth telling apart are `400` and `404`, and they mean
 * different things to the person looking at the screen: one is "try again",
 * the other is "that upload is not yours to finish".
 */
export async function completePhotoUpload(
  imageId: string,
  intentId?: string,
): Promise<PhotoCompleteState> {
  const parsed = z.string().min(1).safeParse(imageId);
  if (!parsed.success) {
    return { message: "There is nothing to confirm." };
  }
  const { token } = await requireOperator();

  /*
    `intentId` is the preferred form and the only one that carries the
    listing: it names the row recording which listing this photograph is for.
    `imageId` is kept as the compatibility form the contract keeps permanently
    — a photograph minted before the listing was chosen at upload has no
    intent row to name — so this sends the intent when it has one and falls
    back rather than refusing.
  */
  const intent = z
    .string()
    .min(1)
    .safeParse(intentId ?? "");

  try {
    const { data, error } = await operatorApi(token).POST(
      "/media/photo-intents/complete",
      {
        body: intent.success
          ? { intentId: intent.data }
          : { imageId: parsed.data },
      },
    );
    if (error) throw error;

    if (!data.mediaAssetId) {
      return { message: "That upload did not finish. Try again." };
    }

    // It is now a media asset awaiting review, and appears in `GET /media`
    // like any other. The library must show it.
    /*
      NOT revalidated here. Every one of these is called from the reel sheet on
      `/account`, and revalidating that route unmounts the sheet and the receipt
      inside it before the operator has read either — the rule this repo learned
      at #43 and twice at #45. The grid refreshes when the sheet closes.
    */
    return { mediaAssetId: data.mediaAssetId };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. We could not confirm it. Try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 400) {
        // "The upload has not arrived at the host yet." The honest reading is
        // that the file never made it, whatever the browser reported.
        return { message: "That upload did not finish. Try again." };
      }
      if (err.isNotFound) {
        /*
          404 covers "no such image" and "minted for another operator"
          identically, on purpose: "telling somebody that image exists but is
          not yours confirms it exists." One message, and it does not
          speculate about which.
        */
        return { message: "We could not find that upload. Try again." };
      }
      if (err.status === 503) {
        return { message: "Photographs are switched off for now." };
      }
    }
    return { message: "We could not confirm that upload. Try again." };
  }
}
