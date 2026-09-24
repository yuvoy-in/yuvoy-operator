import Image from "next/image";
import { cn } from "@/lib/cn";

/**
 * The Yuvoy mark: the ensō with its terracotta dot and the tracked YUVOY caps,
 * side by side in one line. No tagline.
 *
 * ## Why the tagline is gone (yuvoy-operator#80 t1)
 *
 * "The marketing logo, tagline and all, sits on top of a work tool." This
 * drew the delivered horizontal lockup, which bakes the handwritten
 * "Experience more." and its underline into the same art as the mark, so every
 * screen opened at 6am on a jetty carried an advertisement to somebody who had
 * already bought, a line of height above the day. The traveller app dropped
 * the tagline on 14 Sep (yuvoy-app#36); this is the same drawing, and it is the
 * only one the portal draws, so a tagline cannot come back through a prop.
 *
 * ## Where the art comes from
 *
 * The two files under `public/brand` are byte-for-byte copies of yuvoy-app's
 * `yuvoy-mark-compact-on-{dark,light}.svg`, which its
 * `scripts/generate-feed-lockup.mjs` derives from the delivered lockup in
 * yuvoy-web: tagline and underline dropped, the caps re-centred on the ensō.
 * Never hand-edit them; after a brand redelivery, regenerate there and copy
 * both across. `palette.test.ts` fails a dark-surface mark that is not drawn
 * in this portal's canvas token.
 *
 * Two files rather than one recoloured at runtime: a paper ensō is invisible
 * on paper and a forest one is invisible on forest.
 *
 * Size it from outside with a height class, and the height means the
 * DRAWING's height: the generated files crop the delivered canvas's empty
 * margins, and the art's ~4:1 ratio sets the width from there.
 */

/* The cropped art box the generator emits, not the delivered 1600x500 canvas. */
const ART = { width: 1007, height: 253 } as const;

/** Keyed by the colour of the MARK, not of the surface behind it. */
const SRC = {
  paper: "/brand/yuvoy-mark-compact-on-dark.svg",
  forest: "/brand/yuvoy-mark-compact-on-light.svg",
} as const;

export function Wordmark({
  tone = "paper",
  className,
  priority = false,
}: {
  /** The colour of the MARK, chosen to contrast with the surface behind it. */
  tone?: "paper" | "forest";
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={SRC[tone]}
      alt="Yuvoy"
      width={ART.width}
      height={ART.height}
      unoptimized
      priority={priority}
      className={cn("h-6 w-auto", className)}
    />
  );
}
