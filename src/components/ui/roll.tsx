"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DURATION } from "@/lib/motion";
import { rollFigure } from "@/lib/motion/figure";

/**
 * A figure that rolls to its new value (O07 A, approved 4 Oct 2026): the
 * boarding headcount, read at arm's length. The old number leaves upward as
 * the new one comes up from below (150ms out, accelerating away; 200ms in),
 * and the other way when it goes down, so the eye sees which way it moved
 * without reading it twice. The first number drawn simply appears
 * (`rollFigure`, which the Bookings count rolls with too).
 *
 * The old number is `aria-hidden`: the figure sits in its screen's polite
 * live region, which says the new number once. It is drawn from an attribute
 * (`content: attr()`), not as text, so for the moment it is on screen the
 * figure's text is still the one number, for anything that reads it.
 *
 * Reduced motion: nothing travels; the two numbers cross-fade in 120ms.
 */
export function Roll({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const [was, setWas] = useState<{ value: number; up: boolean } | null>(null);
  const [changes, setChanges] = useState(0);
  if (value !== shown) {
    setWas({ value: shown, up: value > shown });
    setShown(value);
    setChanges((n) => n + 1);
  }

  const now = useRef<HTMLSpanElement>(null);
  const old = useRef<HTMLSpanElement>(null);
  const up = was?.up ?? true;
  /*
    The change last drawn. Letting the old number go turns `up` back to its
    default, and a fall used to roll a second time, upward, when it did.
  */
  const drawn = useRef(0);
  useLayoutEffect(() => {
    if (changes === 0 || changes === drawn.current) return;
    drawn.current = changes;
    rollFigure(now.current, old.current, up);
  }, [changes, up]);

  // The old number is let go once it has rolled away.
  useEffect(() => {
    if (!was) return;
    const timer = setTimeout(() => setWas(null), DURATION.standard + 50);
    return () => clearTimeout(timer);
  }, [was, changes]);

  return (
    <span className="relative inline-block">
      <span key={changes} ref={now} className="inline-block">
        {value}
      </span>
      {was ? (
        <span
          key={`was-${changes}`}
          ref={old}
          aria-hidden="true"
          data-was={was.value}
          className="pointer-events-none absolute inset-0 before:content-[attr(data-was)]"
        />
      ) : null}
    </span>
  );
}
