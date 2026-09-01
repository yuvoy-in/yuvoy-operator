import { cn } from "@/lib/cn";

/**
 * The portal's one button.
 *
 * Sized to `dock-target` (56px) rather than the traveller app's 44px. The user
 * of this screen has wet hands, direct sun and eleven people waiting, and a
 * mis-tap here marks the wrong person off a manifest.
 */
export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      {...props}
      className={cn(
        "rounded-edge dock-target label w-full px-5 font-bold transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-55",
        variant === "primary" && "bg-forest text-cream",
        variant === "secondary" &&
          "border-cream-line bg-cream-deep text-forest border",
        // Not red-as-decoration: the only destructive action in the portal is
        // calling off a departure, and it should not look like a save button.
        variant === "danger" && "border-terra-deep text-terra-deep border-2",
        className,
      )}
    />
  );
}
