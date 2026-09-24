"use client";

import { useEffect } from "react";

/**
 * Marking the field a step was opened for (yuvoy-operator#85 s10, the audit
 * before release, O12).
 *
 * "Show the listing as it stands, with the missing field marked in place, and
 * let Edit open on that field." A row of the draft's read-back that says
 * "Still needed" opens its step with `?field=`, and the step marks that field
 * the way the read-back does, in words and with `aria-invalid`, and moves focus
 * to it. Before, the step opened and nothing said which box was the one.
 *
 * Once the step has been saved, its own answer decides what is marked: the
 * field that was missing may have been filled.
 */
export function fieldMarks(
  saved: readonly string[] | undefined,
  flagged: string | undefined,
) {
  const isFlagged = (mark: string) => !saved && flagged === mark;
  return {
    /** For `aria-invalid`: `true`, or nothing at all. */
    marked: (mark: string) =>
      (saved ? saved.includes(mark) : flagged === mark) || undefined,
    /** For `aria-describedby`: the hint, and the "Still needed" line when shown. */
    describedBy: (mark: string, inputId: string, help?: string) =>
      [help, isFlagged(mark) ? `${inputId}-needed` : null]
        .filter(Boolean)
        .join(" ") || undefined,
    /** The read-back's own words for it, under the label. */
    needed: (mark: string, inputId: string) =>
      isFlagged(mark) ? (
        <p
          id={`${inputId}-needed`}
          className="text-terra-deep mt-1 text-sm font-bold"
        >
          Still needed
        </p>
      ) : null,
  };
}

/**
 * Focus on the field the step was opened for, once, when it arrives. A group
 * (the price basis) takes it on its first choice.
 */
export function FocusOnArrival({ id }: { id: string }) {
  useEffect(() => {
    const element = document.getElementById(id);
    const target =
      element instanceof HTMLFieldSetElement
        ? element.querySelector<HTMLElement>("input, select, textarea")
        : element;
    target?.focus();
  }, [id]);
  return null;
}
