"use client";

import { useState } from "react";

/**
 * What the business says about itself, clamped to two lines — #58 item 2.
 *
 * "more" expands in place rather than opening anything. The story is up to 600
 * characters and the profile is a scanning surface: three paragraphs at the top
 * push the numbers, the buttons and the listings below the fold on a phone.
 */
export function About({ text }: { text: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3">
      <p className={open ? "text-sm" : "line-clamp-2 text-sm"}>{text}</p>
      {/*
        Always offered rather than measured. Knowing whether two lines actually
        clipped needs the rendered height, which is a layout read on every
        paint; a "more" on a short story costs one tap and reveals the same
        text, which is the cheaper mistake.
      */}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-terra-deep tap-target text-sm font-bold underline underline-offset-4"
        >
          more
        </button>
      ) : null}
    </div>
  );
}
