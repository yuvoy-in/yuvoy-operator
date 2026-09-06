"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  confirmUpload,
  createUploadIntent,
  type UploadIntent,
} from "./actions";
import {
  formatBytes,
  localRefusals,
  preflight,
  refuses,
  type LocalVideoFacts,
  type PreflightProblem,
} from "@/lib/media/preflight";
import { TusError, readUploadState, uploadResumable } from "@/lib/media/tus";
import { decideSlot, identityOf, type FileIdentity } from "@/lib/media/slot";
import { forgetSlot, recallSlot, rememberSlot } from "@/lib/media/slot-store";
import { marketTime } from "@/lib/format/market-time";
import { RightsForm } from "./rights-form";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";

/**
 * The four steps, as one screen that never loses its place.
 *
 * The person doing this is on a boat with one bar of signal and a 40 MB clip.
 * Everything below is arranged around that: nothing is uploaded before it has
 * been checked locally, the progress is real rather than a spinner, a dropped
 * connection is a pause rather than a failure, and the last step says plainly
 * that attesting is not publishing.
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

export function Uploader() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
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

    An intent is not tied to a file: `POST /media/upload-intents` takes no
    request body and the API never learns what is going into the URL it hands
    out. Since yuvoy-api#66 §3 asking again RESUMES the upload in flight rather
    than refusing it, so the slot survives a reload — and so does the hazard.
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

  const pick = useCallback(async (file: File) => {
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
      const started = await createUploadIntent();
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

    const decision = decideSlot(known, identityOf(file), server);

    if (decision.kind === "unreachable") {
      setPhase({
        name: "failed",
        message:
          "We could not reach the upload server. Check your signal and try again — nothing has been sent.",
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
  }, []);

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
      const result = await confirmUpload(intent.intentId);
      if (result.message) {
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
      Sixty seconds of polling is up. There is no `GET /media` to check on it
      later (yuvoy-api#66), so "check back shortly" pointed at nothing — the
      one way to look again is the way in: the same clip picked again resumes
      at the server's offset, which is the end, and asks the API once more.
    */
    setPhase({
      name: "failed",
      message:
        "The video is taking longer than usual to process. Nothing is lost — choose the same clip again and we will check on it.",
      bound: identityOf(file),
      uploaded: file.size,
    });
  }, []);

  if (phase.name === "attesting") {
    return <RightsForm mediaAssetId={phase.mediaAssetId} />;
  }

  return (
    <div>
      {phase.name === "rejected" ? (
        <div>
          {phase.problems.map((p) => (
            <p
              key={p.message}
              role="alert"
              className="text-terra-deep text-sm font-bold"
            >
              {p.message}
            </p>
          ))}
          <Button
            onClick={() => setPhase({ name: "idle" })}
            variant="secondary"
            className="mt-4"
          >
            Choose a different clip
          </Button>
          {/* No intent was asked for, so the operator's single upload slot is
              untouched and the next choice starts clean. */}
          <p className="text-forest/70 mt-2 text-xs">
            Nothing was sent, and nothing was used up.
          </p>
        </div>
      ) : null}

      {phase.name === "held" ? (
        <div>
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {phase.by
              ? `This upload already holds ${formatBytes(phase.uploaded ?? 0)} of ${phase.by.name}.`
              : `An upload is already going for this business, and it is not this clip — ${formatBytes(phase.uploaded ?? 0)} of something else has arrived.`}
          </p>
          {/*
            One clip at a time is the API's rule. What CAN happen is said
            plainly, and it depends on whether the bytes can be named.

            Named: this phone started it, so "choose it again" is real advice.
            Unnamed: another device, a colleague, or storage that was cleared —
            and telling somebody to choose a clip nothing can name would be
            advice they cannot act on. So they get the one true fact instead,
            which is when the slot frees up.
          */}
          <p className="text-forest/70 mt-2 text-sm">
            {phase.by ? (
              <>
                One clip at a time. Choose {phase.by.name} again and it carries
                on from where it stopped — this works after closing the tab or
                restarting your phone. A different clip cannot go in until that
                one finishes
              </>
            ) : (
              <>
                One clip at a time, and this browser did not start that one — so
                it cannot be picked up from here. Whoever did can carry on with
                it from their own phone. Anything else waits until it finishes
              </>
            )}
            {phase.intent.expiresAt
              ? ` or times out at ${marketTime(phase.intent.expiresAt, "Asia/Kolkata")}`
              : " or times out"}
            .
          </p>
          <Button
            onClick={() => setPhase({ name: "idle" })}
            variant="secondary"
            className="mt-4"
          >
            Pick a clip again
          </Button>
        </div>
      ) : null}

      {phase.name === "idle" || phase.name === "failed" ? (
        <>
          <label htmlFor="reel" className="label text-forest/75 block">
            Choose a clip
          </label>
          <input
            id="reel"
            type="file"
            accept="video/*"
            className={inputClass("mt-2 h-auto py-4")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          {phase.name === "failed" &&
          phase.bound &&
          (phase.uploaded ?? 0) > 0 ? (
            /*
              The way back, said beside the way in. The slot is holding this
              clip's bytes; choosing it again is a resume, choosing another is
              a refusal.
            */
            <p className="text-forest/80 mt-2 text-xs">
              Choose {phase.bound.name} again and it carries on from{" "}
              {formatBytes(phase.uploaded ?? 0)} — nothing already sent is sent
              twice.
            </p>
          ) : (
            <p className="text-forest/70 mt-2 text-xs">
              Filmed upright, on a phone, is exactly right. We check the length
              and the shape here before anything is sent.
            </p>
          )}
        </>
      ) : null}

      {phase.name === "checking" ? (
        <p className="text-base font-bold" role="status">
          Checking the clip…
        </p>
      ) : null}

      {phase.name === "ready" ? (
        <div>
          <p className="text-base font-bold">{phase.file.name}</p>
          <p className="text-forest/70 mt-1 text-sm">
            {formatBytes(phase.file.size)}
          </p>

          {phase.problems.map((p) => (
            <p
              key={p.message}
              role={p.severity === "refuse" ? "alert" : "status"}
              className={
                p.severity === "refuse"
                  ? "text-terra-deep mt-3 text-sm font-bold"
                  : "text-forest/80 mt-3 text-sm"
              }
            >
              {p.message}
            </p>
          ))}

          {phase.resumeFrom > 0 ? (
            <p className="text-forest/80 mt-3 text-sm" role="status">
              Picks up from {formatBytes(phase.resumeFrom)} already uploaded —
              nothing is sent twice.
            </p>
          ) : null}

          {refuses(phase.problems) ? (
            <Button
              onClick={() => setPhase({ name: "idle" })}
              variant="secondary"
              className="mt-4"
            >
              Choose a different clip
            </Button>
          ) : (
            <>
              <Button
                onClick={() => void send(phase.file, phase.intent)}
                className="mt-4"
              >
                Upload it
              </Button>
              {/*
                This line used to be a warning and is now a reassurance, which
                is the whole of yuvoy-api#66 §3 in one sentence. Asking for the
                intent again returns the upload in flight with a fresh URL, so
                a closed tab is recoverable rather than fatal.

                It still says to stay, because staying is quicker than coming
                back — and it says what happens if they cannot, because the
                person this screen was written for is holding a phone on a boat
                and the honest sentence is the one that stops them starting
                over from zero.
              */}
              <p className="text-forest/70 mt-3 text-xs">
                Best to stay on this page until it finishes. Losing signal is
                fine — it picks up where it left off. If the tab closes or your
                phone restarts, come back here and choose the same clip: it
                carries on from where it stopped.
              </p>
            </>
          )}
        </div>
      ) : null}

      {phase.name === "uploading" ? (
        <div>
          <p className="text-base font-bold">Uploading {phase.file.name}</p>
          {/*
            A real number, not a spinner. Twenty minutes of a progress bar that
            moves is a different experience from twenty minutes of one that
            might have stopped.
          */}
          <progress
            className="accent-forest mt-3 h-3 w-full"
            max={phase.file.size}
            value={phase.uploaded}
            aria-label="Upload progress"
          />
          <p className="text-forest/80 mt-2 text-sm" role="status">
            {formatBytes(phase.uploaded)} of {formatBytes(phase.file.size)}
            {phase.file.size > 0
              ? ` · ${Math.floor((phase.uploaded / phase.file.size) * 100)}%`
              : ""}
          </p>
          {phase.resumes > 0 ? (
            /*
              Named rather than hidden. The connection dropping is the common
              path here, and an operator who sees it recover once trusts the
              screen for the next twenty minutes.
            */
            <p className="text-forest/70 mt-2 text-sm">
              The connection dropped {phase.resumes}{" "}
              {phase.resumes === 1 ? "time" : "times"} and picked up again.
              Nothing was lost.
            </p>
          ) : null}
          <Button
            onClick={() => abort.current?.abort()}
            variant="secondary"
            className="mt-4"
          >
            Stop
          </Button>
        </div>
      ) : null}

      {phase.name === "processing" ? (
        <div>
          <p className="text-base font-bold" role="status">
            Uploaded. We are processing it now.
          </p>
          {/*
            The bytes are safe either way — "a job keeps polling whether or not
            the client comes back" — but the rights step is on this page and
            there is no `GET /media` to find the clip again from anywhere else.
            So the ask is still to stay, and the way back is still said.
          */}
          <p className="text-forest/70 mt-2 text-sm">
            This takes a minute or two. Stay here if you can — if you lose the
            page, choose the same clip again and we will pick it up from here.
          </p>
          {phase.resumes > 0 ? (
            <p className="text-forest/80 mt-2 text-sm">
              The connection dropped {phase.resumes}{" "}
              {phase.resumes === 1 ? "time" : "times"} on the way up and picked
              up again. Nothing was lost.
            </p>
          ) : null}
        </div>
      ) : null}

      {phase.name === "failed" ? (
        <p role="alert" className="text-terra-deep mt-4 text-sm font-bold">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
