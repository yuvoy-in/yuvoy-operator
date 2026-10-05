"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { cn } from "@/lib/cn";

/**
 * The time in which Undo still works, drawn (O02 A and O07 A, approved
 * 4 Oct 2026): a bar that empties across it, linear. The one long motion in
 * the portal, because it is the information: a bar can be judged at arm's
 * length in sun without reading. It is the `aria-hidden` twin of words the
 * row already says ("Sending in 3 seconds", "Checking in"), which stay.
 *
 * Started from where the window is, not from full: a row drawn part way
 * through (a list re-rendered under it) shows what is left. Its length is the
 * store's own constant, so the bar and the words can never disagree. Under
 * reduced motion it keeps running and steps once a second, in time with the
 * words (`.motion-drain` in globals.css).
 */
export function UndoWindow({
  until,
  hold,
  className,
}: {
  /** When the window closes, on `Date.now()`'s clock. */
  until: number;
  /** How long the whole window is, in ms. */
  hold: number;
  /** Where the bar sits, and how thick it is. */
  className: string;
}) {
  const bar = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const left = Math.min(hold, Math.max(0, until - Date.now()));
    bar.current?.style.setProperty("--window-delay", `${left - hold}ms`);
  }, [until, hold]);
  return (
    <span
      ref={bar}
      aria-hidden="true"
      data-motion=""
      style={
        {
          "--window": `${hold}ms`,
          "--window-steps": String(Math.max(1, Math.round(hold / 1000))),
        } as CSSProperties
      }
      className={cn(
        "motion-drain bg-forest pointer-events-none absolute rounded-full",
        className,
      )}
    />
  );
}
