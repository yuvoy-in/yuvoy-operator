"use client";

import { useEffect, useRef, useState } from "react";
import { DURATION, EASE, play, prefersReducedMotion } from "@/lib/motion";
import { MeasureBefore } from "@/lib/motion/measure-before";
import { Chip, type ChipTone } from "./chip";

/**
 * A booking's state, in a chip that is seen to change (O03 A, approved
 * 4 Oct 2026).
 *
 * The state is why an operator opens a booking at the jetty, and it used to
 * change in one frame: taking the cash turned "Collect ₹9,000" into
 * "Confirmed" in the frame the button went. Now, when the words change while
 * the chip is on screen, the old words fade out (150ms, accelerating away)
 * over the new ones fading in, and the pill's edge eases to its new width
 * (200ms, `--ease-move`) as a clip on a 28px chip, so nothing is laid out
 * per frame. The words carry the state; the motion only says "this one,
 * now". The first words drawn simply appear.
 *
 * The chips this draws sit at the end of their row, so the old chip is
 * pinned by its right edge and it is the left edge that travels.
 *
 * Reduced motion: the words cross-fade in 120ms and the edge does not move.
 */
export function StatusChip({ label, tone }: { label: string; tone: ChipTone }) {
  const [shown, setShown] = useState({ label, tone });
  const [was, setWas] = useState<{ label: string; tone: ChipTone } | null>(
    null,
  );
  const [changes, setChanges] = useState(0);
  if (label !== shown.label || tone !== shown.tone) {
    setWas(shown);
    setShown({ label, tone });
    setChanges((n) => n + 1);
  }

  // The old words are let go once their fade and the edge have played.
  useEffect(() => {
    if (!was) return;
    const timer = setTimeout(() => setWas(null), DURATION.standard + 50);
    return () => clearTimeout(timer);
  }, [was, changes]);

  const box = useRef<HTMLSpanElement>(null);
  const chips = () => {
    const el = box.current;
    return {
      now: el?.querySelector<HTMLElement>("[data-chip-now]") ?? null,
      old: el?.querySelector<HTMLElement>("[data-chip-was]") ?? null,
    };
  };

  return (
    <MeasureBefore
      watch={changes}
      capture={() => chips().now?.offsetWidth ?? 0}
      apply={(before) => {
        const { now, old } = chips();
        if (!now || !before || prefersReducedMotion()) return;
        const after = now.offsetWidth;
        const by = Math.abs(after - before);
        if (by < 1) return;
        const frames = (from: number, to: number) => [
          { clipPath: `inset(0px 0px 0px ${from}px round 9999px)` },
          { clipPath: `inset(0px 0px 0px ${to}px round 9999px)` },
        ];
        const timing = { duration: DURATION.standard, easing: EASE.move };
        // Narrower: the old chip's edge travels in to the new width.
        if (after < before && old) {
          play(old, frames(0, by), { ...timing, fill: "forwards" });
        }
        // Wider: the new chip's edge travels out from the old width.
        if (after > before) play(now, frames(by, 0), timing);
      }}
    >
      <span ref={box} className="relative inline-flex shrink-0">
        <Chip
          key={changes}
          tone={tone}
          data-chip-now=""
          data-motion=""
          className={changes > 0 ? "motion-in" : undefined}
        >
          {label}
        </Chip>
        {was ? (
          <Chip
            key={`was-${changes}`}
            tone={was.tone}
            aria-hidden="true"
            data-chip-was=""
            data-motion=""
            className="motion-out pointer-events-none absolute top-0 right-0"
          >
            {was.label}
          </Chip>
        ) : null}
      </span>
    </MeasureBefore>
  );
}
