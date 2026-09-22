"use client";

import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/ui/wordmark";
import { useChrome } from "./chrome-context";

/**
 * Whose portal this is: the compact mark and the business's own name, side
 * by side (yuvoy-operator#80 t1).
 *
 * "Use the compact mark with no tagline, at half the height, and put the
 * business name beside it." The mark says which product; the name says which
 * business, which is the thing a manager who runs two, or a crew phone passed
 * between boats, actually needs to see first.
 *
 * The name truncates rather than wraps: the strip is one line on a 360px
 * phone with the inbox beside it, and a long name pushing the inbox off the
 * edge would cost the one control on it. No name, and the mark stands alone.
 */
export function StageIdentity({
  className,
  size = "stage",
}: {
  className?: string;
  /** The phone's stage strip, or the desktop rail's wider head. */
  size?: "stage" | "rail";
}) {
  const { businessName } = useChrome();

  return (
    <div
      className={cn(
        "flex min-w-0",
        size === "rail" ? "flex-col gap-3" : "items-center gap-3",
        className,
      )}
    >
      <Wordmark
        tone="paper"
        className={cn("shrink-0", size === "rail" ? "h-6 self-start" : "h-5")}
        priority
      />
      {businessName ? (
        <>
          {size === "stage" ? (
            <span
              aria-hidden="true"
              className="bg-paper/25 h-4 w-px shrink-0"
            />
          ) : null}
          <span
            className={cn(
              "text-paper min-w-0 truncate font-bold",
              size === "rail" ? "text-base" : "text-sm",
            )}
          >
            {businessName}
          </span>
        </>
      ) : null}
    </div>
  );
}
