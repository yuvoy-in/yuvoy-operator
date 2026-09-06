"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * The business's join link, to hand over by hand.
 *
 * ## Why a screen needs this at all
 *
 * There is no WhatsApp delivery yet (yuvoy-api#68), so the invitation message
 * this API queues never arrives. `POST /team` returns `joinUrl` for exactly
 * that reason — "on an island the person doing the inviting is usually
 * standing next to the person being invited, and a link they can paste beats
 * waiting for one to arrive" — and the portal threw it away, which made
 * inviting somebody a dead end for the invitee. yuvoy-operator#23.
 *
 * ## Why it lives here and not only in the flash after a submit
 *
 * `GET /team` returns it too. An owner who invited somebody yesterday, closed
 * the tab, and now needs to send the link again should not have to re-invite
 * to see it — and re-inviting "replaces the open invitation rather than adding
 * one", so the code the invitee is holding would stop working.
 *
 * ## What it does not do
 *
 * **It never shows a code.** Every sign-in code in the product is currently one
 * fixed demo value while delivery does not exist, and anybody who read it could
 * sign in as any operator. The link is safe to show and the code is not: the
 * link "grants nothing on its own — the number must already have been invited".
 */
export function JoinLink({ url, note }: { url: string; note?: string }) {
  /*
    Three states, not two. "Copied" that never goes away is a button that looks
    broken the second time somebody needs it, and a failure has to say so —
    `navigator.clipboard` is absent on a non-secure origin and throws when the
    document is not focused, which is not rare on a phone.
  */
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
      window.setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("failed");
    }
  };

  return (
    <Panel>
      <p className="text-base font-bold">Your join link</p>
      <p className="text-forest/80 mt-2 text-sm">
        {note ??
          "Send this to anybody you have added. The same link works for all of them, and it only works for a number you have already invited."}
      </p>

      {/*
        Selectable and wrapping, because copying is not the only way this gets
        used — it is read aloud, retyped, and photographed. `break-all` rather
        than truncation for the same reason: a link with an ellipsis in it is a
        link nobody can retype.
      */}
      <p className="rounded-control border-cream-line bg-cream text-forest mt-3 border p-3 font-mono text-sm break-all select-all">
        {url}
      </p>

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={copy} variant="secondary" block={false}>
          {state === "copied" ? "Copied ✓" : "Copy the link"}
        </Button>
        {state === "failed" ? (
          /*
            Not an error to apologise for — the link is right there and
            selectable. This says what to do instead, which is all it can.
          */
          <p role="status" className="text-forest/80 text-sm">
            Could not copy it here — select the link above and copy it by hand.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
