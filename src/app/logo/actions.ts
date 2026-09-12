"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";

/**
 * The logo — yuvoy-operator#35 §2, #33.
 *
 * `POST /logo/upload-intents` → post the file to the host → `PUT /logo`.
 * The two endpoints have existed for a while and nothing called either, which
 * is why `LOGO_MISSING` was a blocker on the Business screen with no way to
 * clear it: an operator could read that a logo is mandatory before they can be
 * booked, and their only route to one was to ring us.
 *
 * Bytes never pass through our API, for the same reason video does not, and
 * the session token is never attached to the host's URL — that URL is a
 * one-time write credential for a bucket, not a key to our API.
 */

export interface LogoIntentState {
  intent?: { imageId: string; uploadUrl: string; maxBytes?: number };
  message?: string;
  /** Image hosting is off on this deployment. Not retryable by the operator. */
  unavailable?: boolean;
}

export async function createLogoIntent(): Promise<LogoIntentState> {
  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/logo/upload-intents",
      {},
    );
    if (error) throw error;

    if (!data.imageId || !data.uploadUrl) {
      return { message: "We could not start the upload. Try again." };
    }
    return {
      intent: {
        imageId: data.imageId,
        uploadUrl: data.uploadUrl,
        // The host's ceiling, read rather than guessed: a number this build
        // invented would be the wrong one the day the limit moves.
        maxBytes: data.maxBytes,
      },
    };
  } catch (err) {
    return failure(err);
  }
}

export interface LogoSaveState {
  logoUrl?: string;
  message?: string;
  unavailable?: boolean;
}

/**
 * Save it — and the HOST is asked whether the file arrived, not the browser.
 *
 * "A client that says it finished and a file that actually exists are
 * different claims, and storing an unconfirmed id produces a card with a
 * broken image — worse than the plain one it replaced."
 */
export async function saveLogo(imageId: string): Promise<LogoSaveState> {
  const parsed = z.string().min(1).safeParse(imageId);
  if (!parsed.success) return { message: "There is nothing to save." };

  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).PUT("/logo", {
      body: { imageId: parsed.data },
    });
    if (error) throw error;

    /*
      The logo is on the Business screen's blocker list and on this one, so
      both have to stop saying it is missing the moment it is not.
    */
    revalidatePath("/logo");
    revalidatePath("/account");
    return { logoUrl: data.logoUrl };
  } catch (err) {
    if (err instanceof OperatorApiError && err.status === 400) {
      // "The upload has not arrived at the host yet." The honest reading is
      // that the file never made it, whatever the browser reported.
      return { message: "That upload did not finish. Choose it again." };
    }
    return failure(err);
  }
}

/** The failures both calls share, worded once. */
function failure(err: unknown): { message: string; unavailable?: boolean } {
  if (err instanceof OperatorNetworkError) {
    return { message: "No signal. Nothing was changed." };
  }
  if (err instanceof OperatorApiError) {
    if (err.status === 403) {
      return { message: "Your role cannot change the logo." };
    }
    if (err.status === 503) {
      /*
        "Image hosting is not configured on this service." Not the operator's
        problem and not something a retry fixes, so it is said as a state
        rather than as a failure they should try again.
      */
      return {
        unavailable: true,
        message:
          "Logos are switched off for now: nothing to do with your picture. We will tell you when they open.",
      };
    }
    if (err.status === 502) {
      return { message: "The picture host did not answer. Try again." };
    }
  }
  return { message: "We could not do that. Try again." };
}
