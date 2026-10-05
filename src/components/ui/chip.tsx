import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * A chip: a fact or a state, in a pill.
 *
 *   neutral  — a role, a count, a date
 *   accent   — something that needs answering: a clock running out, a hold
 *   selected — the chosen one of a set (the day, the month)
 *
 * On a paper sheet the accent tone is `terra-deep` on `paper-deep` (5.49:1).
 * There is no dark-surface chip in the portal; nothing sits on the stage but
 * chrome.
 *
 * `data-chip` is the stable way to find one, from a test or a script. Its
 * classes are styling and move with the type system: v3.2 took off the
 * `label` class the team's tests used to find a role chip.
 */
export type ChipTone = "neutral" | "accent" | "selected";

const TONE: Record<ChipTone, string> = {
  neutral: "border-paper-line bg-paper-deep text-forest",
  accent: "border-terra-deep/30 bg-paper-deep text-terra-deep",
  selected: "border-forest bg-forest text-paper",
};

export function Chip({
  tone = "neutral",
  className,
  ...props
}: { tone?: ChipTone } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      data-chip=""
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] whitespace-nowrap",
        TONE[tone],
        className,
      )}
      {...props}
    />
  );
}
