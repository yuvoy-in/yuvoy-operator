import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The Yuvoy wordmark — the owner-delivered horizontal lockup, copied from the
 * traveller app's generated variants and never hand-edited. Two files rather
 * than one recoloured at runtime: a cream ensō is invisible on cream and a
 * forest one on forest.
 */
export function Wordmark({
  tone = "cream",
  className,
  priority = false,
}: {
  tone?: "cream" | "forest";
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={`/brand/yuvoy-lockup-vector-${tone}.svg`}
      alt="Yuvoy"
      width={865}
      height={759}
      unoptimized
      priority={priority}
      className={cn("h-8 w-auto", className)}
    />
  );
}
