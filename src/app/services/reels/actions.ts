"use server";

import { revalidatePath } from "next/cache";
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
      return { message: "No signal. The upload is safe. Try again shortly." };
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

    revalidatePath("/services/reels");
    return { done: { note: data.note } };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. Nothing was recorded. Try again." };
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
    revalidatePath("/services/reels");
    return { withdrawn: { note: data.note } };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. It is still up. Try again." };
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
    revalidatePath("/services/reels");
    return { done: true };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { message: "No signal. The clip was not attached. Try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.isNotFound) {
        return { message: "That clip is not approved for this listing." };
      }
      if (err.status === 409) {
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
        return {
          message: ceiling
            ? `That listing already shows ${ceiling.limit} ${ceiling.noun}. Take one down before adding another: ${ceiling.other} are counted separately and are not affected.`
            : err.message,
        };
      }
      if (err.status === 502) {
        return { message: err.message };
      }
    }
    return { message: "The clip was not attached. Try again." };
  }
}

/**
 * Which of the two per-listing ceilings a `409` hit.
 *
 * Read defensively: `details` is `unknown` on the error, the kind is an open
 * string on the wire, and a shape this build has not met must fall through to
 * the API's own sentence rather than produce a confident wrong one.
 */
function fullCeiling(
  details: unknown,
): { limit: number; noun: string; other: string } | null {
  if (!details || typeof details !== "object") return null;
  const { kind, limit } = details as { kind?: unknown; limit?: unknown };
  if (typeof limit !== "number" || !Number.isFinite(limit)) return null;
  if (kind === "image") {
    return { limit, noun: "photographs", other: "reels" };
  }
  if (kind === "video") {
    return { limit, noun: "reels", other: "photographs" };
  }
  return null;
}

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
    revalidatePath("/services/reels");
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
