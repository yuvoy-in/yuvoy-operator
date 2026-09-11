"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { sentence } from "@/lib/format/sentence";
import {
  aboutIssue,
  aboutSize,
  languagesIssue,
  parseLanguages,
} from "@/lib/story/story";

/**
 * Your story's writes — yuvoy-operator#41.
 *
 * ## No role gate on any of them
 *
 * "Not behind step-up and not OWNER-only. Nothing here takes money, moves
 * money, or puts anything on sale." None of the story operations declares a
 * 403, and `pnpm qa` fails a gate the contract did not ask for — inventing one
 * would stop the person who actually runs the boat from describing it.
 *
 * ## Photographs ride the logo's upload intent
 *
 * "Upload the bytes through the existing image upload intent, then send the
 * `imageId`." So `POST /logo/upload-intents` mints the slot, the browser posts
 * the file straight to the image host, and only then is the id sent here.
 *
 * The order is load-bearing. `POST /story/photos` does not ask the host
 * whether the file arrived — `PUT /logo` does — so an id sent after a failed
 * upload would put a broken tile on the traveller's page. The uploader sends
 * it only after the host has said yes. Raised on yuvoy-operator#41.
 */

/* ---------------------------------------------------------- the words -- */

export interface StoryState {
  message?: string;
  field?: "about" | "languages";
  /** Set once saved; `about` says whether there is still an About to show. */
  saved?: { about: boolean };
}

export async function saveStory(
  _prev: StoryState,
  form: FormData,
): Promise<StoryState> {
  const about = String(form.get("about") ?? "");
  const languages = parseLanguages(String(form.get("languages") ?? ""));

  const aboutProblem = aboutIssue(about);
  if (aboutProblem) return { field: "about", message: aboutProblem };
  const languagesProblem = languagesIssue(languages);
  if (languagesProblem) {
    return { field: "languages", message: languagesProblem };
  }

  const { token } = await requireOperator();

  try {
    /*
      Both fields, every time: the PUT replaces them. Trimmed as the API trims,
      so what is saved is what the count on the screen measured.
    */
    const { error } = await operatorApi(token).PUT("/story", {
      body: { about: about.trim(), languages },
    });
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was saved — try again." };
    }
    if (err instanceof OperatorApiError && err.status === 400 && err.message) {
      // "tell them 40 to 600 characters about the business" — the API's own
      // reason, which names the rule better than a paraphrase would.
      return { message: sentence(err.message) };
    }
    return { message: "It was not saved. Try again." };
  }

  revalidatePath("/story");
  return { saved: { about: aboutSize(about) > 0 } };
}

/* ------------------------------------------------------ the photographs -- */

export interface PhotoIntentState {
  intent?: { imageId: string; uploadUrl: string; maxBytes?: number };
  message?: string;
  /** Image hosting is off on this deployment. Not retryable by the operator. */
  unavailable?: boolean;
}

export async function createPhotoIntent(): Promise<PhotoIntentState> {
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
        // The host's ceiling, read rather than guessed.
        maxBytes: data.maxBytes,
      },
    };
  } catch (err) {
    return photoFailure(err);
  }
}

export interface AddPhotoState {
  added?: boolean;
  message?: string;
  unavailable?: boolean;
}

/** Put an uploaded image on the page. Called only after the host said yes. */
export async function addStoryPhoto(imageId: string): Promise<AddPhotoState> {
  const parsed = z.string().trim().min(1).safeParse(imageId);
  if (!parsed.success) return { message: "There is nothing to add." };

  const { token } = await requireOperator();

  try {
    /*
      A double tap is safe: "sending the same image twice returns the
      photograph you already have rather than an error."
    */
    const { error } = await operatorApi(token).POST("/story/photos", {
      body: { imageId: parsed.data },
    });
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorApiError) {
      if (err.status === 409) {
        return {
          message:
            "You already have five photographs, the most your page shows. Remove one first.",
        };
      }
      if (err.status === 400) {
        return {
          message:
            "That picture did not reach us in a form we can use — choose it again.",
        };
      }
    }
    return photoFailure(err);
  }

  revalidatePath("/story");
  return { added: true };
}

export interface RemovePhotoState {
  message?: string;
}

export async function removeStoryPhoto(
  _prev: RemovePhotoState,
  form: FormData,
): Promise<RemovePhotoState> {
  const id = String(form.get("photoId") ?? "").trim();
  if (!id) return { message: "There is nothing to remove." };

  const { token } = await requireOperator();

  try {
    const { error } = await operatorApi(token).DELETE("/story/photos/{id}", {
      params: { path: { id } },
    });
    if (error) throw error;
  } catch (err) {
    if (err instanceof OperatorApiError && err.status === 404) {
      /*
        Already gone — a second tab, or a tap that landed twice. The list
        catching up is the right answer, not an error about a photograph that
        is no longer there.
      */
      revalidatePath("/story");
      return {};
    }
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. It is still on your page — try again." };
    }
    return { message: "It was not removed. Try again." };
  }

  revalidatePath("/story");
  return {};
}

/** The failures the photograph calls share, worded once. */
function photoFailure(err: unknown): {
  message: string;
  unavailable?: boolean;
} {
  if (err instanceof OperatorNetworkError) {
    return { message: "No signal. Nothing was added — try again." };
  }
  if (err instanceof OperatorApiError) {
    if (err.status === 403) {
      return { message: "Your role cannot add photographs." };
    }
    if (err.status === 503) {
      // "Image hosting is not configured on this service." Not theirs to fix,
      // and not something a retry fixes, so it is said as a state.
      return {
        unavailable: true,
        message:
          "Photographs cannot be added right now — nothing is wrong with your picture.",
      };
    }
    if (err.status === 502) {
      return { message: "The picture host did not answer. Try again." };
    }
  }
  return { message: "We could not do that. Try again." };
}
