"use client";

import { useRef, useState } from "react";
import { addStoryPhoto, createPhotoIntent } from "./actions";
import { formatBytes } from "@/lib/media/preflight";
import { Panel } from "@/components/ui/panel";

/**
 * Choose a photograph, send it to the image host, put it on the page —
 * yuvoy-operator#41.
 *
 * The logo's three steps, and for the same reasons: bytes go straight to the
 * host ("an API that proxies image bytes is an API that falls over on island
 * 4G"), there is no resume because the host takes one multipart POST, and
 * there is no progress bar because `fetch` reports no upload progress — a bar
 * here would be an animation pretending to be a measurement.
 *
 * No rights attestation, unlike a reel's photograph: the contract puts none on
 * a story photo, and inventing a gate the server does not have is not this
 * screen's call.
 */
type Phase =
  | { name: "idle"; added?: boolean }
  | { name: "preparing" }
  | { name: "uploading"; file: File }
  | { name: "saving" }
  | { name: "failed"; message: string; unavailable?: boolean };

const DID_NOT_ARRIVE =
  "The picture did not reach us. Check your signal and try again — nothing was added.";

export function PhotoUploader({ remaining }: { remaining: number }) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);
  const busy =
    phase.name === "preparing" ||
    phase.name === "uploading" ||
    phase.name === "saving";

  async function choose(file: File | undefined) {
    if (!file || busy) return;

    // The free refusal first, before a slot with a thirty-minute expiry is
    // asked for.
    if (!file.type.startsWith("image/")) {
      setPhase({
        name: "failed",
        message:
          "That is not a picture. A JPEG or a PNG of the boat, the shop or the crew.",
      });
      return;
    }

    setPhase({ name: "preparing" });
    const started = await createPhotoIntent();
    if (!started.intent) {
      setPhase({
        name: "failed",
        message: started.message ?? "We could not start the upload.",
        unavailable: started.unavailable,
      });
      return;
    }

    if (started.intent.maxBytes && file.size > started.intent.maxBytes) {
      setPhase({
        name: "failed",
        message: `That is ${formatBytes(file.size)} and we accept up to ${formatBytes(started.intent.maxBytes)}.`,
      });
      return;
    }

    setPhase({ name: "uploading", file });

    try {
      /*
        Straight to the host, with the field name the contract states. The
        operator session is deliberately NOT sent: that URL is a one-time
        write credential for a bucket, not a key to our API.
      */
      const body = new FormData();
      body.append("file", file, file.name);
      const res = await fetch(started.intent.uploadUrl, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        setPhase({ name: "failed", message: DID_NOT_ARRIVE });
        return;
      }
    } catch {
      setPhase({ name: "failed", message: DID_NOT_ARRIVE });
      return;
    }

    /*
      Only now. `POST /story/photos` does not check with the host, so this is
      the one place that stands between a failed upload and a broken tile on
      the traveller's page.
    */
    setPhase({ name: "saving" });
    const saved = await addStoryPhoto(started.intent.imageId);
    if (saved.message) {
      setPhase({
        name: "failed",
        message: saved.message,
        unavailable: saved.unavailable,
      });
      return;
    }

    if (inputRef.current) inputRef.current.value = "";
    setPhase({ name: "idle", added: true });
  }

  return (
    <div>
      {phase.name === "failed" ? (
        <Panel tone="alert" className="mb-4 p-4">
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {phase.message}
          </p>
        </Panel>
      ) : null}

      {phase.name === "idle" && phase.added ? (
        <p role="status" className="text-forest mb-4 text-sm font-bold">
          Added. It is on your page now.
        </p>
      ) : null}

      <label htmlFor="story-photo" className="label text-forest/75">
        Add a photograph
      </label>
      <input
        ref={inputRef}
        id="story-photo"
        type="file"
        accept="image/*"
        className="mt-2 block w-full text-sm"
        disabled={
          busy || (phase.name === "failed" && phase.unavailable === true)
        }
        onChange={(e) => void choose(e.target.files?.[0])}
        aria-describedby="story-photo-hint"
      />
      <p id="story-photo-hint" className="text-forest/70 mt-2 text-xs">
        {remaining === 1 ? "Room for one more." : `Room for ${remaining} more.`}
      </p>

      {phase.name === "preparing" ? (
        <p role="status" className="text-forest/80 mt-3 text-sm font-bold">
          Getting ready…
        </p>
      ) : null}
      {phase.name === "uploading" ? (
        <p role="status" className="text-forest/80 mt-3 text-sm font-bold">
          Sending {phase.file.name}…
        </p>
      ) : null}
      {phase.name === "saving" ? (
        <p role="status" className="text-forest/80 mt-3 text-sm font-bold">
          Putting it on your page…
        </p>
      ) : null}
    </div>
  );
}
