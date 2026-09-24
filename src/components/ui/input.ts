import { cn } from "@/lib/cn";

/**
 * The field classes, in one place.
 *
 * The portal's forms are plain labelled inputs driven by Server Actions —
 * every `<input>` carries its own `id` and `name`, which is what `pnpm qa`
 * and the e2e suite read — so the shared thing is the LOOK, not a component.
 * 56px tall on this surface, for the same wet hand `dock-target` is sized to.
 */
export function inputClass(className?: string): string {
  return cn(
    "rounded-control border-paper-line bg-paper-deep text-forest w-full border px-4 text-base outline-none",
    "transition-[border-color,background-color] duration-200 ease-interaction",
    "focus:border-forest/60 focus:bg-paper placeholder:text-forest/70",
    /*
      A field marked invalid is SEEN to be, not only announced: a refused save,
      or the field Edit was opened for (#85 s10). It was `aria-invalid` alone,
      which a sighted operator never saw.
    */
    "aria-[invalid=true]:border-terra-deep aria-[invalid=true]:border-2",
    "h-14",
    className,
  );
}

/** A textarea: the same field, free-height. */
export function textareaClass(className?: string): string {
  return cn(
    "rounded-control border-paper-line bg-paper-deep text-forest w-full border p-4 text-base outline-none",
    "transition-[border-color,background-color] duration-200 ease-interaction",
    "focus:border-forest/60 focus:bg-paper",
    "aria-[invalid=true]:border-terra-deep aria-[invalid=true]:border-2",
    className,
  );
}

/**
 * A choice row: a radio and its words, as one tappable card. `checked` draws
 * the forest ring so the chosen one reads without reading.
 */
export function choiceClass(checked?: boolean, className?: string): string {
  return cn(
    "rounded-card flex min-h-14 cursor-pointer items-center gap-3 border px-4 py-3 text-sm",
    "transition-[border-color,background-color,box-shadow] duration-200 ease-interaction",
    checked
      ? "border-forest bg-paper ring-1 ring-forest"
      : "border-paper-line bg-paper hover:border-forest/40",
    className,
  );
}

/**
 * The words that name a field.
 *
 * NOT the `label` utility, which is uppercase and wide-tracked. That is the
 * brand's editorial voice and it belongs over a section, not on a box somebody
 * is about to type in: set in it, an ordinary question becomes "WHAT IS IT
 * CALLED", which is the same question shouted (yuvoy-operator#85 s11).
 *
 * Sentence case, at 14px, a step above the 12px hint underneath it and a step
 * below the 16px the field itself is set in. Inline, like the `<label>` it
 * dresses, so a label sitting beside its control still can.
 */
export function fieldLabelClass(className?: string): string {
  return cn("text-forest/75 text-sm font-medium", className);
}
