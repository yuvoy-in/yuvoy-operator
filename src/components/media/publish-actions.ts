"use server";

import { z } from "zod";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { suspendedMessage } from "@/lib/account/suspended";
import { fullCeiling } from "./action-helpers";

/*
  Attaching to a listing and moving between cover and gallery, moved from
  actions.ts so no file runs past 500 lines (yuvoy-operator#178).
*/

/* --------------------------------------------------------------- attach -- */

export interface AttachState {
  message?: string;
  done?: boolean;
}

const attachSchema = z.object({
  mediaAssetId: z.string().min(1),
  experienceId: z.string().min(1),
  role: z.enum(["hero", "gallery"]),
});

/** Attach a human-approved clip to one of this operator's listings. */
export async function attachMedia(
  _prev: AttachState,
  form: FormData,
): Promise<AttachState> {
  const parsed = attachSchema.safeParse({
    mediaAssetId: String(form.get("mediaAssetId") ?? ""),
    experienceId: String(form.get("experienceId") ?? ""),
    role: String(form.get("role") ?? "gallery"),
  });
  if (!parsed.success) {
    return { message: "Choose a listing and where this clip should appear." };
  }

  const { token } = await requireOperator();
  try {
    const { error } = await operatorApi(token).POST("/media/{id}/publish", {
      params: { path: { id: parsed.data.mediaAssetId } },
      body: {
        experienceId: parsed.data.experienceId,
        role: parsed.data.role,
      },
    });
    if (error) throw error;
    /*
      NOT revalidated here. Every one of these is called from the reel sheet on
      `/account`, and revalidating that route unmounts the sheet and the receipt
      inside it before the operator has read either — the rule this repo learned
      at #43 and twice at #45. The grid refreshes when the sheet closes.
    */
    /*
      NOT `/account`. The Reels tab draws the same media, but the sheet that
      called this is a client component on that tree: revalidating it unmounts
      the sheet and the receipt inside it before the operator has read either.
      The sheet refreshes on their tap instead — the rule this repo learned
      three times over, at #43, #45 and #45 again.
    */
    return { done: true };
  } catch (err) {
    return { message: publishFailure(err, "The clip was not attached.") };
  }
}

/* ------------------------------------------------- cover or gallery (#58) -- */

export interface RoleState {
  message?: string;
  done?: boolean;
}

const roleSchema = z.object({
  mediaAssetId: z.string().min(1),
  experienceId: z.string().min(1),
  role: z.enum(["hero", "gallery"]),
});

/**
 * Move a reel between the cover and the gallery of the listing it is already
 * on — yuvoy-operator#58 item 6.
 *
 * The same endpoint as attaching, with the listing it already names. Two
 * buttons rather than a state, because `OperatorMedia` does not carry the role
 * yet: until it does, this portal cannot say which one a reel currently is, and
 * a button that claims to know would be wrong half the time. Publishing the
 * role it already holds is safe — the API takes it and answers `204`.
 */
export async function setMediaRole(
  _prev: RoleState,
  form: FormData,
): Promise<RoleState> {
  const parsed = roleSchema.safeParse({
    mediaAssetId: String(form.get("mediaAssetId") ?? ""),
    experienceId: String(form.get("experienceId") ?? ""),
    role: String(form.get("role") ?? ""),
  });
  if (!parsed.success) {
    return { message: "Choose the cover or the gallery." };
  }

  const { token } = await requireOperator();
  try {
    const { error } = await operatorApi(token).POST("/media/{id}/publish", {
      params: { path: { id: parsed.data.mediaAssetId } },
      body: {
        experienceId: parsed.data.experienceId,
        role: parsed.data.role,
      },
    });
    if (error) throw error;
    /*
      NOT revalidated here. Every one of these is called from the reel sheet on
      `/account`, and revalidating that route unmounts the sheet and the receipt
      inside it before the operator has read either — the rule this repo learned
      at #43 and twice at #45. The grid refreshes when the sheet closes.
    */
    // Not `/account`: see `attachMedia`.
    return { done: true };
  } catch (err) {
    return { message: publishFailure(err, "It was not moved.") };
  }
}

/**
 * Every way `POST /media/{id}/publish` can refuse, in one place.
 *
 * Attaching to a listing and moving between cover and gallery are the same
 * call, so they get the same sentences. Two copies of this map would drift on
 * the first one somebody edits, and the ceiling message is the one an operator
 * has to act on.
 */
function publishFailure(err: unknown, lead: string): string {
  if (err instanceof OperatorNetworkError) {
    return `No signal. ${lead} Try again.`;
  }
  if (err instanceof OperatorApiError) {
    /*
      Suspension first: `403 account_suspended` is the one 403 publishing
      declares, and it read "{lead} Try again" (yuvoy-operator#90 f13). Both
      callers, attaching and moving between cover and gallery, get it from
      here.
    */
    const refusal = suspendedMessage(err);
    if (refusal) return refusal;
    if (err.isNotFound) {
      // The API does not separate "not yours" from "not approved", and neither
      // does this. Approval is the cause an operator can do something about.
      return "This one is not approved yet.";
    }
    if (err.status === 409) {
      /*
        TWO different 409s, and the first is not a ceiling at all.

        `hero_taken` means the listing already shows a cover: the way out is
        the gallery, or moving the current cover to the gallery first. Saying
        "already shows 20" to that operator sends them hunting for a limit
        they have not reached.
      */
      if (err.code === "hero_taken") {
        /*
          The API's own sentence, which changed with yuvoy-api#191 and is the
          one to render: the way out is to publish the current cover as
          `gallery`, which DEMOTES it, rather than to "move" it in some other
          screen. Ours said "choose Gallery, or move the current cover to the
          gallery first", which named the right act in words the API no longer
          uses.
        */
        return "This listing already has a cover. Make that one a gallery item first, then try again.";
      }
      /*
        A ceiling, and there are TWO of them.

        "Photographs and clips have separate ceilings — 20 each — so a full
        gallery never blocks a reel and a full reel library never blocks a
        photograph." `details.kind` and `details.limit` say which one was
        reached "so the screen can tell somebody which thing to remove rather
        than leaving them to work it out."

        The API's own sentence is the fallback rather than a paraphrase: if
        the details are absent or shaped differently, it still says something
        true, and this portal has not invented a number.
      */
      const ceiling = fullCeiling(err.details);
      return ceiling
        ? `That listing already shows ${ceiling.limit} ${ceiling.noun}. Take one down before adding another: ${ceiling.other} are counted separately and are not affected.`
        : err.message;
    }
    if (err.status === 502) {
      return "That did not go through. Try again.";
    }
    if (err.status === 503) {
      /*
        Not a retry-in-a-moment answer, and the second sentence is why: "it is
        a deployment that is missing configuration, and it stays 503 until
        somebody sets it." An operator told to try again would sit there doing
        it.
      */
      return "Reels cannot be put on a live listing just now. That is a setting at our end, not something that clears on its own.";
    }
  }
  return `${lead} Try again.`;
}
