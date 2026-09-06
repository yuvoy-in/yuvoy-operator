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
 * ## Where it appears, and where it deliberately no longer does
 *
 * Twice: on the invite receipt, and on the pending row of somebody who has not
 * joined. It used to sit permanently at the top of the Team screen as well,
 * and the owner cut that (yuvoy-operator#25 §1).
 *
 * The constraint the third copy was protecting still holds, and the pending
 * row is what holds it: `GET /team` returns the link, so an owner who invited
 * somebody yesterday and closed the tab does not have to re-invite to see it —
 * and re-inviting "replaces the open invitation rather than adding one", so
 * the code the invitee is holding would stop working.
 *
 * ## `compact` — a copy control, and no URL on screen
 *
 * "A raw `https://operators.yuvoy.in/join/l1F-cHTNRK-…` in the layout reads as
 * debug output. A 'Copy invite link' control that copies it is the whole
 * requirement — the person never needs to read it." That is the pending row's
 * shape. The receipt keeps the readable URL, because that is the one moment
 * somebody may want to read it aloud, photograph it, or type it into another
 * device.
 *
 * ## What it does not do
 *
 * **It never shows a code.** Every sign-in code in the product is currently one
 * fixed demo value while delivery does not exist, and anybody who read it could
 * sign in as any operator. The link is safe to show and the code is not: the
 * link "grants nothing on its own — the number must already have been invited".
 */
export function JoinLink({
  url,
  note,
  compact = false,
}: {
  url: string;
  note?: string;
  /** The row form: a copy control and nothing else. See above. */
  compact?: boolean;
}) {
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

  if (compact) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={copy} variant="secondary" block={false}>
          {state === "copied" ? "Copied ✓" : "Copy invite link"}
        </Button>
        {state === "failed" ? (
          <p role="status" className="text-forest/80 text-sm">
            Could not copy it here. Open this page on another device, or invite
            them again to see the link.
          </p>
        ) : null}
      </div>
    );
  }

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
