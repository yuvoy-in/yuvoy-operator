import type { AnchorHTMLAttributes, ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * The portal's one button, as a pill (v2.7).
 *
 * Sized to `dock-target` (56px) by default rather than the traveller app's
 * 44px. The user of this screen has wet hands, direct sun and eleven people
 * waiting, and a mis-tap here marks the wrong person off a manifest.
 *
 *   primary   — the forest fill, for the one action a screen is for
 *   secondary — a raised paper-deep pill, for the other choice
 *   outline   — a hairline pill, for a quieter action
 *   danger    — the accent hairline. Not red-as-decoration: the destructive
 *               actions here (calling off a departure, stopping a bank
 *               change) should not look like a save button.
 *
 * CTAs stay monochrome, as everywhere in the system: terracotta is never a
 * fill.
 */
export type ButtonVariant = "primary" | "secondary" | "outline" | "danger";
export type ButtonSize = "dock" | "md" | "sm";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-forest text-paper hover:bg-forest/90",
  secondary:
    "border border-paper-line bg-paper-deep text-forest hover:border-forest/40",
  outline: "border border-forest/25 text-forest hover:border-forest",
  danger: "border-2 border-terra-deep text-terra-deep hover:bg-terra-deep/5",
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
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  className?: string;
} = {}): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center gap-2 rounded-full label font-bold whitespace-nowrap select-none",
    "transition-[transform,background-color,border-color,color,opacity] duration-200 ease-interaction",
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55",
    VARIANT[variant],
    SIZE[size],
    block && "flex w-full",
    className,
  );
}

export function Button({
  variant,
  size,
  block,
  className,
  type = "button",
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width, which on a phone is the default. */
  block?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, block, className })}
      {...props}
    />
  );
}

/** A `<Link>` styled as a button, for a forward action that is a navigation. */
export function ButtonLink({
  variant,
  size,
  block,
  className,
  href,
  ...props
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  href: string;
} & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  return (
    <Link
      href={href}
      className={buttonClass({ variant, size, block, className })}
      {...props}
    />
  );
}
