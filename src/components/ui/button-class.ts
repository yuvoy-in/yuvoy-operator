import { cn } from "@/lib/cn";

/*
  The Button's look, on its own: `buttonClass` is called from server
  components (a link drawn as a button) as well as from the client Button,
  so it lives in a module with no directive that both can import. The
  variants are described on `Button` (button.tsx).
*/

export type ButtonVariant =
  "primary" | "secondary" | "outline" | "danger" | "danger-quiet";
export type ButtonSize = "dock" | "md" | "sm";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-forest text-paper hover:bg-forest/90",
  secondary:
    "border border-paper-line bg-paper-deep text-forest hover:border-forest/40",
  outline: "border border-forest/25 text-forest hover:border-forest",
  danger: "border-2 border-terra-deep text-terra-deep hover:bg-terra-deep/5",
  "danger-quiet":
    "text-terra-deep underline decoration-terra-deep/40 underline-offset-4 hover:bg-terra-deep/5",
};

const SIZE: Record<ButtonSize, string> = {
  dock: "dock-target px-5",
  md: "h-11 px-5",
  sm: "h-9 px-4 text-[11px]",
};

export function buttonClass({
  variant = "primary",
  size = "dock",
  block = true,
  motion = "control",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /**
   * `control` eases the press and the colours; `press` eases the press
   * alone, for a control whose colour must change in the frame it is
   * tapped (the Bookings pills, O05 B).
   */
  motion?: "control" | "press";
  className?: string;
} = {}): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full label font-bold whitespace-nowrap select-none",
    // The press eases in and out (globals.css, "motion: presses"): both name
    // `scale`, which is the property `active:scale-*` writes.
    motion === "press"
      ? "motion-press active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"
      : "motion-control active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55",
    VARIANT[variant],
    SIZE[size],
    block && "flex w-full",
    className,
  );
}
