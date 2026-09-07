"use client";

import { useRef, useState } from "react";
import {
  completePhotoUpload,
  createPhotoIntent,
  type PhotoIntent,
} from "./actions";
import {
  formatBytes,
  refuses,
  type PreflightProblem,
} from "@/lib/media/preflight";
import {
  localPhotoRefusals,
  photoPreflight,
  readImageFacts,
} from "@/lib/media/photo";
import { RightsForm } from "./rights-form";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * Adding a photograph to the library — yuvoy-operator#27.
 *
 * ## Why a listing needs these at all
 *
 * "A listing page shows a reel or it shows nothing … where an Amazon-shaped one
 * is a video *and* a row of photographs. Operators have photographs. They do
 * not all have footage."
 *
 * ## Three steps, and the middle one leaves this origin
 *
 * ```
 * createPhotoIntent()        → { imageId, uploadUrl, maxBytes }
 * POST uploadUrl (multipart)   straight to the image host — not through us
 * completePhotoUpload(imageId) → { mediaAssetId }
 * ```
 *
 * Then it is the **same road a clip travels**: the same rights attestation, the
 * same review queue, the same publish gate. So this component ends by handing
 * off to `RightsForm`, unchanged — a photograph is not a second pipeline, and a
 * parallel path with weaker gates would be the way round the first one.
 *
 * ## What it does NOT have, and why that is not an oversight
 *
 * **No resume.** The host takes one multipart POST; there is no tus here and
 * nothing to resume from. On a 0.5 Mbps link a 5 MB photograph is about eighty
 * seconds, so the screen says to stay on it rather than promising a recovery
 * that does not exist. That is the honest version of the same rule the clip
 * uploader follows the other way round.
 *
 * **No slot to lose.** A clip intent is one per operator and refuses a second
 * with `409`; the photograph endpoint declares no such refusal, so somebody
 * adding a row of pictures is not fighting their own uploads.
 */

type Phase =
  | { name: "idle" }
  | { name: "checking" }
  | { name: "rejected"; problems: PreflightProblem[] }
  | {
      name: "ready";
      file: File;
      intent: PhotoIntent;
      problems: PreflightProblem[];
    }
  | { name: "uploading"; file: File }
  | { name: "attesting"; mediaAssetId: string }
  | { name: "failed"; message: string };

export function PhotoUploader() {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;

    /*
      The free refusals first, before any slot is asked for. A picture that is
      really a PDF costs nothing to catch here and costs an intent to catch
      after — and an intent carries an expiry.
    */
    const local = localPhotoRefusals(file);
    if (local.length) {
      setPhase({ name: "rejected", problems: local });
      return;
    }

    setPhase({ name: "checking" });

    const result = await createPhotoIntent();
    if (!result.intent) {
      setPhase({
        name: "failed",
        message: result.message ?? "We could not start the upload.",
      });
      return;
    }

    /*
      The size check runs against the intent's OWN ceiling, which is why it
      waits until now rather than guessing at 5 MB up front. `maxBytes` is the
      server's and may move without a deploy here.
    */
    const facts = await readImageFacts(file);
    const problems = photoPreflight(
      file,
      { maxBytes: result.intent.maxBytes },
      facts,
    );
    if (refuses(problems)) {
      setPhase({ name: "rejected", problems });
      return;
    }

    setPhase({ name: "ready", file, intent: result.intent, problems });
  }

  async function upload(file: File, intent: PhotoIntent) {
    setPhase({ name: "uploading", file });

    try {
      /*
        Straight to the host. The field name is `file`, which the contract
        states — and the operator session is deliberately NOT sent: this URL is
        a one-time write credential for a bucket, not a key to our API, and
        attaching a bearer token to a third-party origin is how one leaks.
      */
      const body = new FormData();
      body.append("file", file, file.name);

      const res = await fetch(intent.uploadUrl, { method: "POST", body });
      if (!res.ok) {
        setPhase({
          name: "failed",
          message:
            "The picture did not reach us. Check your signal and try again — nothing was saved.",
        });
        return;
      }
    } catch {
      setPhase({
        name: "failed",
        message:
          "The picture did not reach us. Check your signal and try again — nothing was saved.",
      });
      return;
    }

    /*
      The host is asked, not us. A browser that says it finished is a browser
      saying anything it likes, which is exactly why `complete` exists.
    */
    const done = await completePhotoUpload(intent.imageId);
    if (!done.mediaAssetId) {
      setPhase({
        name: "failed",
        message: done.message ?? "That upload did not finish — try again.",
      });
      return;
    }

    setPhase({ name: "attesting", mediaAssetId: done.mediaAssetId });
  }

  function reset() {
    if (inputRef.current) inputRef.current.value = "";
    setPhase({ name: "idle" });
  }

  // Same attestation a clip needs, same component. No second path.
  if (phase.name === "attesting") {
    return <RightsForm mediaAssetId={phase.mediaAssetId} />;
  }

  return (
    <div>
      {phase.name === "rejected" ? (
        <Panel tone="alert" className="mb-4 p-4">
          {phase.problems.map((p) => (
            <p key={p.message} className="text-terra-deep text-sm font-bold">
              {p.message}
            </p>
          ))}
        </Panel>
      ) : null}

      {phase.name === "failed" ? (
        <Panel tone="alert" className="mb-4 p-4">
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {phase.message}
          </p>
        </Panel>
      ) : null}

      {phase.name === "idle" ||
      phase.name === "rejected" ||
      phase.name === "failed" ? (
        <div>
          <label htmlFor="photo-file" className="label text-forest/75">
            Choose a photograph
          </label>
          <input
            ref={inputRef}
            id="photo-file"
            type="file"
            accept="image/*"
            className="mt-2 block w-full text-sm"
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <p className="text-forest/70 mt-2 text-xs">
            A JPEG or PNG of the real thing. It goes to a person here before any
            traveller sees it.
          </p>
        </div>
      ) : null}

      {phase.name === "checking" ? (
        <p role="status" className="text-forest/80 text-sm font-bold">
          Checking that picture…
        </p>
      ) : null}

      {phase.name === "ready" ? (
        <div>
          <p className="text-base font-bold">{phase.file.name}</p>
          <p className="text-forest/70 mt-1 text-sm">
            {formatBytes(phase.file.size)}
          </p>

          {phase.problems.map((p) => (
            <p key={p.message} className="text-forest/80 mt-3 text-sm">
              {p.message}
            </p>
          ))}

          {/*
            Said before the tap, because it is the one thing this flow cannot
            do. There is no resume: one multipart POST, and a dropped
            connection means starting again.
          */}
          <p className="text-forest/70 mt-3 text-xs">
            Stay on this screen while it uploads — a photograph goes in one go
            and cannot pick up where it left off.
          </p>

          <div className="mt-4 flex gap-2">
            <Button
              onClick={() => void upload(phase.file, phase.intent)}
              variant="primary"
              block={false}
              className="flex-1"
            >
              Upload it
            </Button>
            <Button
              onClick={reset}
              variant="secondary"
              block={false}
              className="flex-1"
            >
              Choose another
            </Button>
          </div>
        </div>
      ) : null}

      {phase.name === "uploading" ? (
        /*
          No percentage. `fetch` reports no upload progress without streams the
          host would have to accept, so a bar here would be an animation
          pretending to be a measurement — and on a slow link that is the
          moment somebody decides the app has frozen. A named file and an
          honest sentence is what can be said truthfully.
        */
        <p role="status" className="text-forest/80 text-sm font-bold">
          Sending {phase.file.name}… this takes about a minute on island signal.
        </p>
      ) : null}
    </div>
  );
}
