"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * A block the server draws once something has happened, faded in when it
 * appears while the screen is open (150ms; 120ms under reduced motion), and
 * simply there when the screen opens with it.
 *
 * For a server-rendered page that a Server Action re-renders in place: the
 * banner a call-off puts at the top of its manifest (O06 B) should arrive,
 * not cut in, but an operator opening a departure that was called off
 * yesterday should not watch it fade. The difference is whether `when`
 * turned true during this component's life, which only a client component
 * that stays mounted across the re-render can know.
 *
 * Always one `div` when shown, carrying `className`, so the page lays out
 * exactly as it did when it drew that `div` itself.
 */
export function Arrival({
  when,
  className,
  children,
}: {
  when: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [was, setWas] = useState(when);
  const [arrivals, setArrivals] = useState(0);
  if (when !== was) {
    setWas(when);
    if (when) setArrivals((n) => n + 1);
  }
  if (!when) return null;
  return (
    <div
      key={arrivals}
      data-motion={arrivals > 0 ? "" : undefined}
      className={cn(className, arrivals > 0 && "motion-in")}
    >
      {children}
    </div>
  );
}
