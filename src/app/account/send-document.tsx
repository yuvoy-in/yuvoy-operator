"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  completeDocumentUpload,
  startDocumentUpload,
} from "./document-actions";
import {
  ACCEPT_ATTRIBUTE,
  fileProblem,
  type AllowedType,
} from "@/lib/account/documents";
import { Button } from "@/components/ui/button";

/**
 * Send the file behind one pending document — yuvoy-operator#46 item 3.
 *
 * ```
 * startDocumentUpload()   → { intentId, uploadUrl, method, headers }
 * PUT uploadUrl           straight to the private bucket, not through us
 * completeDocumentUpload() → the API asks the bucket what actually arrived
 * ```
 *
 * ## Why the bytes do not pass through the API
 *
 * "The file never passes through this API." A registration certificate is a few
 * megabytes over an island connection, and routing it through a request our
 * server has to hold open is the difference between an upload that survives a
 * dropped bar and one that starts again.
 *
 * ## The URL is a credential and is held for one tick
 *
 * "Never stored server-side and never logged: it is a credential for writing one
 * file into a private bucket, and it works for fifteen minutes." It lives in a
 * local const inside `send()` and reaches no state, so a React devtools tree or
 * a serialised error cannot carry it. The operator's session is NOT attached to
 * that request either: a bearer token sent to a third-party origin is how one
 * leaks.
 *
 * ## The file is checked before the intent
 *
 * "The size and the kind are signed into the URL, so the bucket itself refuses a
 * file of any other length or content type" — so a 12 MB file would upload in
 * full and then be turned away. It is refused here instead, before anything
 * leaves the phone.
 */
type Phase =
  | { name: "idle" }
  | { name: "working"; what: string }
  | { name: "done"; filename: string; replaced: boolean }
  | { name: "failed"; message: string };

export function SendDocument({
  credentialId,
  label,
}: {
  credentialId: string;
  /** The document's own name, so a page of these says which is which. */
  label: string;
}) {
  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const fieldId = `document-file-${credentialId}`;

  async function send(file: File) {
    const problem = fileProblem(file);
    if (problem) {
      setPhase({ name: "failed", message: problem });
      return;
    }

    setPhase({ name: "working", what: "Preparing…" });
    const intent = await startDocumentUpload(
      credentialId,
      file.name,
      file.type as AllowedType,
      file.size,
    );
    if (!intent.ok) {
      setPhase({ name: "failed", message: intent.message });
      return;
    }

    /*
      The server's own ceiling, checked against the file already in hand rather
      than after the upload. `fileProblem` has already applied the contract's 10
      MB; this is the number THIS intent was signed for, which is the one the
      bucket will actually enforce.
    */
    if (intent.maxBytes && file.size > intent.maxBytes) {
      setPhase({
        name: "failed",
        message:
          "That file is larger than this upload allows. Send a smaller copy.",
      });
      return;
    }

    setPhase({ name: "working", what: "Sending…" });
    try {
      /*
        `headers` exactly as given, and nothing added. They are signed into the
        URL — "`Content-Type` and the upload's `x-amz-meta-*` metadata" — so an
        extra or altered header makes the bucket refuse the file. No
        credentials, no session: see the module comment.
      */
      const res = await fetch(intent.uploadUrl, {
        method: intent.method,
        headers: intent.headers,
        body: file,
      });
      if (!res.ok) {
        setPhase({
          name: "failed",
          message:
            "The file did not reach us. Check your signal and try again. Nothing was changed.",
        });
        return;
      }
    } catch {
      setPhase({
        name: "failed",
        message:
          "The file did not reach us. Check your signal and try again. Nothing was changed.",
      });
      return;
    }

    setPhase({ name: "working", what: "Checking…" });
    const done = await completeDocumentUpload(credentialId, intent.intentId);
    if (!done.ok) {
      setPhase({ name: "failed", message: done.message });
      return;
    }

    setPhase({
      name: "done",
      filename: done.filename,
      replaced: done.replacedPrevious,
    });
    /*
      The row behind this picks up the name from the revalidate. Refreshed as
      well so a page that was already rendered when the action landed catches
      up without the operator navigating.
    */
    router.refresh();
  }

  function reset() {
    if (input.current) input.current.value = "";
    setPhase({ name: "idle" });
  }

  if (phase.name === "done") {
    return (
      <div role="status" className="mt-3 text-sm">
        <p className="font-bold">{phase.filename} is with us</p>
        <p className="text-forest/80 mt-1">
          {/*
            Nothing here says the document is verified, because it is not:
            "nothing here verifies the document. It still waits for somebody at
            Yuvoy, who opens the file to decide."
          */}
          {phase.replaced
            ? "It replaced the file we had. Somebody at Yuvoy still has to check it."
            : "Somebody at Yuvoy still has to check it."}
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <label htmlFor={fieldId} className="label text-forest/75">
        Send the file
        <span className="sr-only"> for {label}</span>
      </label>
      <input
        id={fieldId}
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        disabled={phase.name === "working"}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void send(file);
        }}
        className="text-forest/80 mt-2 block w-full text-sm"
      />
      <p className="text-forest/70 mt-1.5 text-xs">
        A PDF, a JPEG or a PNG, up to 10 MB.
      </p>

      {phase.name === "working" ? (
        <p role="status" className="text-forest/80 mt-2 text-sm font-bold">
          {phase.what}
        </p>
      ) : null}

      {phase.name === "failed" ? (
        <div className="mt-2">
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {phase.message}
          </p>
          <Button
            variant="secondary"
            block={false}
            className="mt-2"
            onClick={reset}
          >
            Pick another file
          </Button>
        </div>
      ) : null}
    </div>
  );
}
