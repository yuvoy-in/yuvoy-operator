"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { pillScrollLeft } from "@/lib/bookings/list";

/**
 * The four pills, in one row that scrolls sideways and never wraps
 * (yuvoy-operator#83 s4).
 *
 * A wrapped row read as two groups rather than one choice. On a phone the
 * row is wider than the sheet, so it bleeds to the sheet's edges and scrolls
 * under them, which is also what says there is more to the right. The padding
 * inside the scroller is the room a focus ring needs: an overflowing box clips
 * whatever is drawn outside it, including a ring on its first or last pill.
 *
 * The selected pill is scrolled into view once it is drawn, and only the row
 * moves: `scrollIntoView` would also scroll the page, which on a screen that
 * has just opened is a jump nobody asked for.
 */
export function PillRow({
  label,
  selected,
  children,
}: {
  /** The navigation's accessible name. */
  label: string;
  /** Which pill is lit, so the row follows it when it changes. */
  selected: string;
  children: ReactNode;
}) {
  const row = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = row.current;
    const current = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !current) return;
    el.scrollLeft = pillScrollLeft(
      current.offsetLeft,
      current.offsetWidth,
      el.clientWidth,
      el.scrollWidth,
    );
  }, [selected]);

  return (
    <nav
      ref={row}
      aria-label={label}
      className="no-scrollbar relative -mx-6 mt-5 flex gap-2 overflow-x-auto px-6 py-1.5 sm:-mx-10 sm:px-10"
    >
      {children}
    </nav>
  );
}
