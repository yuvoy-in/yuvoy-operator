"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmUpload,
  createUploadIntent,
  type UploadIntent,
} from "./upload-actions";
import {
  formatBytes,
  localRefusals,
  preflight,
  type LocalVideoFacts,
  type PreflightProblem,
} from "@/lib/media/preflight";
import { TusError, readUploadState, uploadResumable } from "@/lib/media/tus";
import { decideSlot, identityOf, type FileIdentity } from "@/lib/media/slot";
import { forgetSlot, recallSlot, rememberSlot } from "@/lib/media/slot-store";
import { callAction } from "@/lib/actions/call-action";

/**
 * What the uploader does, apart from what it draws: the phase it is in, the
 * listing and role a new slot is asked for, and the two steps that move it on.
 * `pick` checks a chosen clip and the slot; `send` uploads it and waits for
 * the provider. The screen is `Uploader` in `./uploader`.
 */

type Phase =
  | { name: "idle" }
  | { name: "checking" }
  | {
      name: "ready";
      file: File;
      intent: UploadIntent;
      problems: PreflightProblem[];
      /** Bytes the server already holds of THIS file. Zero for a fresh one. */
      resumeFrom: number;
    }
  /** Refused locally, before an upload slot was ever asked for. */
  | { name: "rejected"; problems: PreflightProblem[] }
  /**
   * The slot holds bytes that are not this clip's. Nothing else may go in
   * until that one finishes or the slot expires — see `decideSlot`.
   *
   * `by` is null when nothing can name them: another device, a colleague, or
   * storage that was cleared. Two different sentences, because "choose X
   * again" is no help when nothing knows what X was.
   */
  | {
      name: "held";
      by: FileIdentity | null;
      uploaded: number | null;
      intent: UploadIntent;
    }
  | {
      name: "uploading";
      file: File;
      intent: UploadIntent;
      uploaded: number;
      resumes: number;
    }
  | { name: "processing"; intent: UploadIntent; resumes: number }
  | { name: "attesting"; mediaAssetId: string }
  | {
      name: "failed";
      message: string;
      /** The clip the slot is holding, so the screen can say how to carry on. */
      bound?: FileIdentity;
      uploaded?: number;
    };

/**
 * Read the length and shape out of the file, locally, before uploading it.
 *
 * Best effort on purpose. A phone's HEVC clip is something one browser decodes
 * and another does not, and Cloudflare handles both — so a browser that cannot
 * read it returns nothing and `preflight` warns instead of refusing.
 */
function readVideoFacts(file: File): Promise<LocalVideoFacts> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    let settled = false;

    const done = (facts: LocalVideoFacts) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(facts);
    };

    // A file the browser will never decode must not hang the screen.
    const timer = setTimeout(() => done({}), 5_000);

    video.preload = "metadata";
    video.onloadedmetadata = () => {
      clearTimeout(timer);
      done({
        seconds: Number.isFinite(video.duration) ? video.duration : undefined,
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
      });
    };
    video.onerror = () => {
      clearTimeout(timer);
      done({});
    };
    video.src = url;
  });
}

export function useUploader(fixedExperienceId?: string) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  /*
    Which listing this clip is for — yuvoy-operator#31 §1. Optional on this
    route while it is optional on the wire, so an operator with no listings
    yet is not locked out of uploading; the picker says so in its own words
    and the file input stays open.
  */
  const [experienceId, setExperienceId] = useState(fixedExperienceId ?? "");
  const [role, setRole] = useState<"hero" | "gallery">("gallery");
  const abort = useRef<AbortController | null>(null);

  /*
    Still armed, for a smaller reason than it used to have.

    Closing mid-upload was once unrecoverable: the slot was burned until it
    timed out. Since yuvoy-api#66 §3 it is recoverable — come back, choose the
    same clip, carry on — so this is no longer the only thing standing between
    an operator and a lost twenty minutes. It stays because recovering still
    costs a few taps and a wait, and the one tap that avoids all of it is the
    one the browser is offering.
  */
  const busy = phase.name === "uploading" || phase.name === "processing";
  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);
  /*
    The upload slot, kept across file changes — and bound to the file whose
    bytes it holds.

    An intent is tied to a byte length, not a file identity: the API knows how
    many bytes belong in the provider slot but cannot know their filename or
    modification time. Since yuvoy-api#66 §3 asking again RESUMES the upload in
    flight rather than refusing it, the slot survives a reload — and so does
    the hazard.
    tus resumes from the SERVER's offset, and a slot that has taken 1 MB of
    clip A must not be handed clip B: B would carry on from A's offset and the
    result is one corrupt reel — A's head, B's tail — confirmed, attested and
    sent to review.

    `bound` is what THIS page watched go in. It is null on every fresh load,
    which is why it is no longer the only source: `recallSlot` is what the
    browser remembers, and `decideSlot` weighs both against what the server
    says it is holding.
  */
  const slot = useRef<{
    intent: UploadIntent;
    bound: FileIdentity | null;
  } | null>(null);

  const pick = useCallback(
    async (file: File) => {
      /*
      The free checks first, before anything is spent.

      A photo, or an empty file, needs no server limits to refuse — and asking
      for an intent to find that out burns the operator's single upload slot on
      a file that was never going to be uploaded. A first version did exactly
      that, and every subsequent upload in the session met "an upload is
      already going".
    */
      const local = localRefusals(file);
      if (local.length) {
        setPhase({ name: "rejected", problems: local });
        return;
      }

      setPhase({ name: "checking" });

      // The limits live on the intent, so the rest of the checks need one.
      // Numbers this build guessed would be the wrong ones the day the ceiling
      // moves.
      let intent = slot.current?.intent;
      if (!intent) {
        // A request that never came back says so, rather than "checking"
        // for good (`callAction`).
        const started = await callAction(
          () => createUploadIntent(file.size, experienceId, role),
          () => ({ message: "No signal. Nothing was started." }),
        );
        if (!started.intent) {
          setPhase({
            name: "failed",
            message: started.message ?? "We could not start the upload.",
          });
          return;
        }
        intent = started.intent;
        slot.current = { intent, bound: null };
      }

      /*
      Whose bytes does the slot hold?

      Asked of the server EVERY time, not only when this page happens to
      remember binding it. That "only when bound" shortcut was correct while a
      second intent was refused — a page that had just loaded could not obtain
      a URL for an upload in progress, so a fresh page always meant a fresh
      slot. Since §3 it does not, and the shortcut became the bug: a reloaded
      page skipped the check entirely and resumed a different clip into
      another one's offset.

      A `HEAD` is one round trip and the upload opens with the same call
      anyway, so nothing is spent that was not already being spent.
    */
      const known = slot.current?.bound ?? recallSlot(intent.intentId);
      let server = null;
      try {
        server = await readUploadState(intent.uploadUrl, fetch);
      } catch {
        /* Left null. `decideSlot` refuses rather than guesses. */
      }

      // tus fixes the length when the slot is created. On a resumed intent the
      // API echoes the original length, so a different file must be refused even
      // when the provider HEAD response omits its declared length. Ask for HEAD
      // first so the operator can still see how many bytes are already safe.
      if (intent.sizeBytes !== file.size) {
        setPhase({
          name: "held",
          by: known,
          uploaded: server?.offset ?? null,
          intent,
        });
        return;
      }

      const decision = decideSlot(known, identityOf(file), server);

      if (decision.kind === "unreachable") {
        setPhase({
          name: "failed",
          message:
            "We could not reach the upload server. Check your signal and try again. Nothing has been sent.",
        });
        return;
      }
      if (decision.kind === "held") {
        setPhase({
          name: "held",
          by: decision.by,
          uploaded: decision.uploaded,
          intent,
        });
        return;
      }

      let resumeFrom = 0;
      if (decision.kind === "resume") {
        resumeFrom = decision.uploaded;
        // Adopt what the browser remembered, so the rest of this page session
        // reasons about a binding it did not personally watch happen.
        slot.current = { intent, bound: known ?? identityOf(file) };
      } else {
        /*
        A confirmed empty slot. Any binding either half remembers is about an
        upload that is over, and keeping it would refuse the next clip on the
        strength of a record the server has already contradicted.
      */
        slot.current = { intent, bound: null };
        forgetSlot();
      }

      const facts = await readVideoFacts(file);
      setPhase({
        name: "ready",
        file,
        intent,
        problems: preflight(file, intent, facts),
        resumeFrom,
      });
      // `experienceId` and `role` are read when an intent is MINTED, which is
      // inside this callback — so they belong in the deps. Without them a
      // picker change after the first render would mint the intent against a
      // stale listing, which is a silent wrong answer rather than an error.
    },
    [experienceId, role],
  );

  const send = useCallback(async (file: File, intent: UploadIntent) => {
    const controller = new AbortController();
    abort.current = controller;
    /*
      From here the slot belongs to this file — recorded in two places, because
      they answer two different questions. The ref is what this page knows; the
      store is what survives it, and it is written BEFORE the first byte
      because the reload we are protecting against can happen during the first
      byte. It holds the file's identity and never the URL. See `slot-store`.
    */
    const bound = identityOf(file);
    slot.current = { intent, bound };
    rememberSlot(intent.intentId, bound);
    setPhase({ name: "uploading", file, intent, uploaded: 0, resumes: 0 });
    let lastResumes = 0;

    try {
      await uploadResumable({
        url: intent.uploadUrl,
        file,
        chunkBytes: intent.chunkBytes,
        signal: controller.signal,
        onProgress: (p) => {
          lastResumes = p.resumes;
          setPhase({
            name: "uploading",
            file,
            intent,
            uploaded: p.uploaded,
            resumes: p.resumes,
          });
        },
      });
    } catch (err) {
      const uploaded = err instanceof TusError ? err.uploaded : 0;
      setPhase({
        name: "failed",
        message:
          err instanceof TusError
            ? `${err.message} It stopped at ${formatBytes(err.uploaded)} of ${formatBytes(file.size)}.`
            : "The upload stopped.",
        bound,
        uploaded,
      });
      return;
    }

    /*
      The resume count survives into processing, because the line saying a
      dropout recovered is worth more to somebody who looked away for twenty
      minutes than to somebody watching the bar move. It stops at the
      attestation, where "uploaded" has already said it.
    */
    setPhase({ name: "processing", intent, resumes: lastResumes });

    /*
      Poll, because "the client's claim is never trusted" — telling the API the
      bytes are up is a hint, and what decides is whether the provider has a
      finished asset. `202 ready:false` is the normal first answer.
    */
    for (let i = 0; i < 40; i++) {
      const id = intent.intentId;
      const result = await callAction(
        () => confirmUpload(id),
        () => ({
          message: "No signal. The upload is safe. Try again shortly.",
        }),
      );
      if (result.message) {
        if (result.final) {
          /*
            The host's last word on this upload: refused, or gone. The slot is
            over, and so is the record of which clip it holds. Kept, they made
            the next clip meet a dead upload as one "already going", or as an
            upload server that could not be reached, and nothing else could go
            in until a reload (yuvoy-operator#157). Forgotten, the next clip
            asks for a new upload.
          */
          slot.current = null;
          forgetSlot();
        }
        setPhase({ name: "failed", message: result.message });
        return;
      }
      if (result.ready && result.mediaAssetId) {
        /*
          The slot is finished with, so the record of what was in it is too.
          Left behind it would name a file for an intent that will never come
          back — matched on the id, so harmless, but it is the operator's file
          name sitting on their phone for no reason.
        */
        forgetSlot();
        setPhase({ name: "attesting", mediaAssetId: result.mediaAssetId });
        return;
      }
      await new Promise((r) => setTimeout(r, 1_500));
    }

    /*
      Sixty seconds of polling is up. The library can show the processing row
      later; choosing the same file remains the direct way to ask again now.
    */
    setPhase({
      name: "failed",
      message:
        "The video is taking longer than usual to process. Nothing is lost. It will stay in your reel list, or choose the same clip again to check now.",
      bound: identityOf(file),
      uploaded: file.size,
    });
  }, []);

  return {
    phase,
    setPhase,
    experienceId,
    setExperienceId,
    role,
    setRole,
    abort,
    pick,
    send,
  };
}
