"use client";

import { useCallback, useRef, useState } from "react";
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
import { TusError, uploadResumable } from "@/lib/media/tus";
import { RightsForm } from "./rights-form";

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
    }
  /** Refused locally, before an upload slot was ever asked for. */
  | { name: "rejected"; problems: PreflightProblem[] }
  | {
      name: "uploading";
      file: File;
      intent: UploadIntent;
      uploaded: number;
      resumes: number;
    }
  | { name: "processing"; intent: UploadIntent; resumes: number }
  | { name: "attesting"; mediaAssetId: string }
  | { name: "failed"; message: string };

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
    The upload slot, kept across file changes.

    An intent is not tied to a file — `POST /media/upload-intents` takes no
    request body — so picking a different clip reuses the one we already hold
    rather than asking for a second, which the API refuses with 409 while the
    first is open. There is no endpoint to hand one back, so a slot spent is a
    slot gone until it expires.
  */
  const slot = useRef<UploadIntent | null>(null);

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
    let intent = slot.current;
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
      slot.current = intent;
    }

    const facts = await readVideoFacts(file);
    setPhase({
      name: "ready",
      file,
      intent,
      problems: preflight(file, intent, facts),
    });
  }, []);

  const send = useCallback(async (file: File, intent: UploadIntent) => {
    const controller = new AbortController();
    abort.current = controller;
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
      setPhase({
        name: "failed",
        message:
          err instanceof TusError
            ? `${err.message} It stopped at ${formatBytes(err.uploaded)} of ${formatBytes(file.size)}.`
            : "The upload stopped.",
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
        setPhase({ name: "attesting", mediaAssetId: result.mediaAssetId });
        return;
      }
      await new Promise((r) => setTimeout(r, 1_500));
    }

    setPhase({
      name: "failed",
      message:
        "The video is taking longer than usual to process. It is not lost — check back shortly.",
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
          <button
            type="button"
            onClick={() => setPhase({ name: "idle" })}
            className="rounded-edge dock-target label border-cream-line bg-cream-deep text-forest mt-4 w-full border px-5"
          >
            Choose a different clip
          </button>
          {/* No intent was asked for, so the operator's single upload slot is
              untouched and the next choice starts clean. */}
          <p className="text-forest/70 mt-2 text-xs">
            Nothing was sent, and nothing was used up.
          </p>
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
            className="rounded-edge border-cream-line bg-cream-deep mt-2 w-full border p-4 text-base"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          <p className="text-forest/70 mt-2 text-xs">
            Filmed upright, on a phone, is exactly right. We check the length
            and the shape here before anything is sent.
          </p>
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

          {refuses(phase.problems) ? (
            <button
              type="button"
              onClick={() => setPhase({ name: "idle" })}
              className="rounded-edge dock-target label border-cream-line bg-cream-deep text-forest mt-4 w-full border px-5"
            >
              Choose a different clip
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void send(phase.file, phase.intent)}
                className="rounded-edge dock-target label bg-forest text-cream mt-4 w-full px-5 font-bold"
              >
                Upload it
              </button>
              {/*
                The awkward truth, said before they start rather than after
                they lose it. The upload URL may not be persisted anywhere, and
                a fresh intent is refused while one is in progress — so a closed
                tab is an upload nobody can pick up.
              */}
              <p className="text-forest/70 mt-3 text-xs">
                Keep this tab open until it finishes. Losing signal is fine — it
                picks up where it left off — but closing the tab is not, and the
                upload cannot be resumed afterwards.
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
            className="mt-3 h-3 w-full"
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
          <button
            type="button"
            onClick={() => abort.current?.abort()}
            className="rounded-edge dock-target label border-cream-line bg-cream-deep text-forest mt-4 w-full border px-5"
          >
            Stop
          </button>
        </div>
      ) : null}

      {phase.name === "processing" ? (
        <div>
          <p className="text-base font-bold" role="status">
            Uploaded. We are processing it now.
          </p>
          <p className="text-forest/70 mt-2 text-sm">
            This takes a minute or two. Keep the tab open.
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
