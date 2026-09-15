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
