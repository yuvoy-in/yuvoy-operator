"use client";

import { useLayoutEffect, useRef } from "react";
import {
  DURATION,
  EASE,
  play,
  prefersReducedMotion,
  stopAnimations,
} from "@/lib/motion";
import { takeSeatsSent } from "./seats-sent";

/**
 * How much of a departure is sold, as the bar under its time and seats on
 * the desktop board.
 *
 * ## It grows when the operator sets the seats (O08 A, approved 4 Oct 2026)
 *
 * "On the desktop board the bar would scale from the left, 200ms
 * `--ease-move`." Saving a departure's seats re-reads the board, and its bar
 * jumped to the new length in that frame. Now the bar is laid out at its new
 * length and played back from the old one as a transform from its left edge
 * (`scaleX`, the old fill over the new), so nothing is laid out per frame; a
 * bar growing shorter starts past its new end, inside the track that clips
 * it. The row's 1.2s mark as the inspector leaves is the inspector's own.
 *
 * Only for the count this operator just sent (`takeSeatsSent`): a fill that
 * changes because somebody booked, or another login saved, is a change they
 * did not make, and the portal does not move those. Under reduced motion the
 * bar simply changes.
 */
export function FillBar({
  departure,
  people,
  seats,
}: {
  departure: string;
  people: number;
  seats: number;
}) {
  const fill = seats > 0 ? Math.min(100, (people / seats) * 100) : 0;
  const bar = useRef<HTMLSpanElement>(null);
  /** What the board drew last, to grow from. */
  const was = useRef({ fill, seats });

  // After the commit that draws the new length, before the paint.
  useLayoutEffect(() => {
    const from = was.current;
    was.current = { fill, seats };
    if (from.seats === seats || !takeSeatsSent(departure, seats)) return;
    const el = bar.current;
    if (!el || fill <= 0 || from.fill === fill || prefersReducedMotion()) {
      return;
    }
    stopAnimations(el);
    play(
      el,
      [{ transform: `scaleX(${from.fill / fill})` }, { transform: "none" }],
      { duration: DURATION.standard, easing: EASE.move },
    );
  }, [departure, fill, seats]);

  return (
    <span
      aria-hidden="true"
      className="bg-paper-line mt-1 block h-1 overflow-hidden rounded-full"
    >
      <span
        ref={bar}
        className="bg-forest block h-1 origin-left rounded-full"
        style={{ width: `${fill}%` }}
      />
    </span>
  );
}
