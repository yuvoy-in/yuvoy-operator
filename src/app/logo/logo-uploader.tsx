"use client";

import { useRef, useState } from "react";
import { createLogoIntent, saveLogo } from "./actions";
import { formatBytes } from "@/lib/media/preflight";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * Choose a picture, send it to the host, save it — yuvoy-operator#35 §2.
 *
 * Three steps, and the middle one leaves this origin. Shorter than the reel
 * and photograph paths on purpose: **a logo is not moderated**. It is
 * presentation rather than content, nothing is verified against it, and the
 * contract says so — it is "editable after go-live, unlike the rest of the
 * business details". So there is no rights attestation here, and adding one
 * would be inventing a gate the server does not have.
 *
 * No resume and no progress bar, for the same reasons the photograph uploader
 * gives: the host takes one multipart POST, and `fetch` reports no upload
 * progress without streams the host would have to accept. A bar here would be
 * an animation pretending to be a measurement, which on a slow link is the
 * moment somebody decides the app has frozen.
 */
type Phase =
  | { name: "idle" }
  | { name: "preparing" }
  | { name: "uploading"; file: File }
  | { name: "done"; logoUrl?: string }
  | { name: "failed"; message: string; unavailable?: boolean };

/** Ours, and smaller than any host ceiling: a mark is a mark, not a photograph. */
const LOCAL_MAX_BYTES = 2 * 1024 * 1024;

export function LogoUploader({ hasLogo }: { hasLogo: boolean }) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const inputRef = useRef<HTMLInputElement>(null);

  async function choose(file: File | undefined) {
    if (!file) return;

    /*
      The free refusals first, before any slot is asked for. A picture that is
      really a PDF costs nothing to catch here and costs an intent to catch
      after — and an intent carries a thirty-minute expiry.
    */
    if (!file.type.startsWith("image/")) {
      setPhase({
        name: "failed",
        message: "That is not a picture. A PNG or a JPEG of your logo.",
      });
      return;
    }
    if (file.size > LOCAL_MAX_BYTES) {
      setPhase({
        name: "failed",
        message: `That is ${formatBytes(file.size)}. A logo should be under ${formatBytes(LOCAL_MAX_BYTES)}. It is shown small.`,
      });
      return;
    }

    setPhase({ name: "preparing" });
    const started = await createLogoIntent();
    if (!started.intent) {
      setPhase({
        name: "failed",
        message: started.message ?? "We could not start the upload.",
        unavailable: started.unavailable,
      });
      return;
    }

    // The server's ceiling, checked against the file we already hold rather
    // than after eighty seconds of upload.
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
        Straight to the host. The field name is `file`, which the contract
        states — and the operator session is deliberately NOT sent: that URL
        is a one-time write credential for a bucket, and attaching a bearer
        token to a third-party origin is how one leaks.
      */
      const body = new FormData();
      body.append("file", file, file.name);
      const res = await fetch(started.intent.uploadUrl, {
        method: "POST",
        body,
      });
      if (!res.ok) {
        setPhase({
          name: "failed",
          message:
            "The picture did not reach us. Check your signal and try again. Nothing was changed.",
        });
        return;
      }
    } catch {
      setPhase({
        name: "failed",
        message:
          "The picture did not reach us. Check your signal and try again. Nothing was changed.",
      });
      return;
    }

    const saved = await saveLogo(started.intent.imageId);
    if (saved.message) {
      setPhase({
        name: "failed",
        message: saved.message,
        unavailable: saved.unavailable,
      });
      return;
    }
    setPhase({ name: "done", logoUrl: saved.logoUrl });
  }

  function reset() {
    if (inputRef.current) inputRef.current.value = "";
    setPhase({ name: "idle" });
  }

  if (phase.name === "done") {
    return (
      <Panel tone="alert" className="p-4">
        <p role="status" className="text-forest text-sm font-bold">
          Saved. Your mark is on your listings now.
        </p>
        <p className="text-forest/70 mt-2 text-sm">
          Travellers see it on a card with no clip, and on the page about your
          business. Change it whenever you like. Nothing is verified against it.
        </p>
        <Button onClick={reset} variant="secondary" className="mt-4">
          Choose a different one
        </Button>
      </Panel>
    );
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

      {phase.name === "idle" || phase.name === "failed" ? (
        <div>
          <label htmlFor="logo-file" className="label text-forest/75">
            {hasLogo ? "Replace your logo" : "Choose your logo"}
          </label>
          <input
            ref={inputRef}
            id="logo-file"
            type="file"
            accept="image/*"
            className="mt-2 block w-full text-sm"
            disabled={phase.name === "failed" && phase.unavailable === true}
            onChange={(e) => void choose(e.target.files?.[0])}
          />
          <p className="text-forest/70 mt-2 text-xs">
            A PNG or JPEG, square if you have one. It is shown small, so a
            simple mark reads better than a detailed one.
          </p>
        </div>
      ) : null}

      {phase.name === "preparing" ? (
        <p role="status" className="text-forest/80 text-sm font-bold">
          Getting ready…
        </p>
      ) : null}

      {phase.name === "uploading" ? (
        <p role="status" className="text-forest/80 text-sm font-bold">
          Sending {phase.file.name}…
        </p>
      ) : null}
    </div>
  );
}
