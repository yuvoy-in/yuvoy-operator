import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

/**
 * A panel: the raised card every sheet composes from.
 *
 *   raised  — the default, a paper-deep card on the sheet
 *   outline — a hairline only
 *   alert   — a warning or a failure: the accent hairline, never a red
 *   done    — a receipt: the forest hairline, the ink's own tint
 *
 * Hairlines still do the work shadows do elsewhere. There is no shadow token
 * in this system and this component adds none.
 */
export type PanelTone = "raised" | "outline" | "alert" | "done";

const TONE: Record<PanelTone, string> = {
  raised: "border border-paper-line bg-paper-deep",
  outline: "border border-paper-line bg-paper",
  alert: "border-2 border-terra-deep bg-paper-deep",
  done: "border-2 border-forest bg-forest/5",
};

export function panelClass(tone: PanelTone = "raised", className?: string) {
  return cn("rounded-card text-forest p-5", TONE[tone], className);
}

export function Panel({
  tone = "raised",
  className,
  ...props
}: { tone?: PanelTone } & HTMLAttributes<HTMLDivElement>) {
  return <div className={panelClass(tone, className)} {...props} />;
}
