import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/ui/wordmark";
import { BackButton } from "./back-button";
import { InboxLink } from "./inbox-link";
import { StageIdentity } from "./stage-identity";

/**
 * The screen chassis: v2.7's stage and sheet, as the traveller app draws it.
 *
 * A forest STAGE, and a paper SHEET rising out of it with a 32px top. On a
 * phone the stage is the strip above the sheet; on a desktop it is the whole
 * canvas and the sheet is a panel floating on it.
 *
 *   nav="tabs"    a tab root: the compact mark and the business's name on the
 *                 strip, the floating bar at the foot, and room left for it
 *   nav={{back}}  a focused screen: a back disc, no bar
 *   nav="focused" a focused screen's loading fallback: the back disc's place
 *                 held by an inert disc, since a fallback cannot know where
 *                 back leads, so the real one lands on it and nothing swaps
 *   nav="none"    a signed-out door: the mark and nothing else
 *
 * The registry's `isFocusedRoute` / `isBareRoute` are the other half of that
 * decision, pinned by `nav.test.ts`.
 *
 * ## The strip (yuvoy-operator#80 t1, #96)
 *
 * 56px, one line, and nothing on it that is not either where you are or a
 * way somewhere. It used to be 64px carrying the marketing lockup, tagline
 * and all, on every screen of a work tool. Every signed-in screen carries the
 * inbox at its right edge, after any `stageActions` the screen brings; a
 * signed-out door has no session and so no inbox. On a desktop the rail
 * carries the mark and the name, so a tab root's strip keeps only the inbox.
 */
export type ScreenNav =
  "tabs" | "none" | "focused" | { back: { href: string; label: string } };

export function Screen({
  children,
  nav = "tabs",
  stageLabel,
  stageActions,
  width = "md",
}: {
  children: ReactNode;
  nav?: ScreenNav;
  /**
   * A small tracked caption centred in the stage header.
   *
   * On its way out (yuvoy-operator#80 t2: one title per screen, and the
   * sheet's `h1` is it). Kept working until no screen passes it.
   */
  stageLabel?: string;
  /** Controls at the stage header's right edge, before the inbox. */
  stageActions?: ReactNode;
  /** The sheet's measure: a form, a list, or a page with a wide table. */
  width?: "sm" | "md" | "lg";
}) {
  const back = typeof nav === "object" ? nav.back : null;
  const measure =
    width === "lg" ? "max-w-3xl" : width === "sm" ? "max-w-md" : "max-w-2xl";
  const panel =
    width === "lg"
      ? "lg:max-w-3xl"
      : width === "sm"
        ? "lg:max-w-md"
        : "lg:max-w-2xl";

  return (
    <div className="stage flex flex-1 flex-col lg:px-8 lg:py-8">
      <div
        className={cn(
          "flex flex-1 flex-col lg:mx-auto lg:w-full lg:flex-none",
          panel,
        )}
      >
        <header className="relative flex h-14 items-center gap-3 px-4">
          {back ? (
            <BackButton {...back} />
          ) : nav === "focused" ? (
            <span
              aria-hidden="true"
              className="bg-paper/10 ring-paper/12 inline-flex size-11 shrink-0 rounded-full ring-1"
            />
          ) : nav === "tabs" ? (
            // The rail carries the mark and the name on a desktop.
            <StageIdentity className="lg:hidden" />
          ) : (
            <Wordmark tone="paper" className="h-5" priority />
          )}
          {stageLabel ? (
            <p className="label text-paper/70 pointer-events-none absolute left-1/2 -translate-x-1/2">
              {stageLabel}
            </p>
          ) : null}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {stageActions}
            {nav === "none" ? null : <InboxLink />}
          </div>
        </header>

        <div className="sheet rounded-t-sheet lg:rounded-sheet flex flex-1 flex-col">
          <div
            className={cn(
              "container-page flex flex-1 flex-col pt-6",
              measure,
              nav === "tabs" ? "tabbar-clearance" : "pb-8",
            )}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
