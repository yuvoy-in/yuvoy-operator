import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * A circular control holding one icon. The name is REQUIRED: an icon is
 * decorative and the disc is what a screen reader announces.
 *
 *   chrome — the forest disc that floats over paper
 *   onDark — a translucent disc on the stage, where a forest disc would vanish
 */
type Variant = "chrome" | "onDark" | "onPaper";

const VARIANT: Record<Variant, string> = {
  chrome: "app-chrome ring-1 ring-paper/12 hover:bg-forest/90",
  onDark: "bg-paper/10 text-paper ring-1 ring-paper/12 hover:bg-paper/15",
  onPaper:
    "border border-paper-line bg-paper-deep text-forest hover:border-forest/40",
};

const BASE =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full transition-[transform,background-color,color] duration-200 ease-interaction active:scale-[0.96] disabled:pointer-events-none disabled:opacity-55";

export function IconButton({
  label,
  variant = "chrome",
  className,
  type = "button",
  ...props
}: {
  label: string;
  variant?: Variant;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(BASE, VARIANT[variant], className)}
      {...props}
    />
  );
}

export function IconLink({
  label,
  variant = "chrome",
  className,
  href,
  ...props
}: {
  label: string;
  variant?: Variant;
  href: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "aria-label" | "href">) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className={cn(BASE, VARIANT[variant], className)}
      {...props}
    />
  );
}
