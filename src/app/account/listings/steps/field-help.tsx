import type { ReactNode } from "react";
import { fieldLabelClass } from "@/components/ui/input";

/**
 * What the builder says beside a field, and what it folds away
 * (yuvoy-operator#110).
 *
 * Basics explained three of its fields in full sentences, the same paragraph
 * for an operator's fourth listing as for their first, and nothing told a
 * field the step refuses to save without from one it only encourages. Sai
 * Teja, product: "This need trimming. It's confusing."
 *
 * So a step reads as labels and boxes:
 *
 *   - **`Required`** sits beside the label of a field the step will not save
 *     without (the ones carrying `required`), on every step, so its absence
 *     means the same thing everywhere: this can wait. A field that blocks
 *     sending for review but not saving is not marked: Review names it, and
 *     the read-back marks it "Still needed".
 *   - **One short example** stays under a field, visible, because it changes
 *     what gets typed.
 *   - **A reason or a tip** goes behind `Why`, a native disclosure: it opens
 *     on one bar of signal before any JavaScript arrives, and a screen reader
 *     announces it as expanded or collapsed with no ARIA of ours.
 */

/**
 * A field's label, with `Required` beside it when the step will not save
 * without it.
 *
 * The word is hidden from a screen reader, which already announces the
 * control's own `required`; read twice it is noise. It stays outside the
 * `<label>`, so the field's name is its label and nothing else.
 */
export function FieldLabel({
  htmlFor,
  required = false,
  children,
}: {
  htmlFor: string;
  /** Mirror the control's own `required`. */
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <label htmlFor={htmlFor} className={fieldLabelClass()}>
        {children}
      </label>
      {required ? (
        <span aria-hidden="true" className="text-forest/70 text-xs">
          Required
        </span>
      ) : null}
    </div>
  );
}

/** A reason or a tip, folded away under the field it is about. */
export function Why({
  summary = "Why?",
  children,
}: {
  summary?: string;
  children: ReactNode;
}) {
  return (
    <details className="mt-1">
      <summary className="text-forest/80 tap-target cursor-pointer list-none text-sm underline underline-offset-4 [&::-webkit-details-marker]:hidden">
        {summary}
      </summary>
      <p className="text-forest/70 mt-1 text-xs">{children}</p>
    </details>
  );
}
