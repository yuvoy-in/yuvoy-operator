import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Wordmark } from "@/components/ui/wordmark";
import { BackButton } from "./back-button";

/**
 * The screen chassis — v2.7's stage and sheet, as the traveller app draws it.
 *
 * A forest STAGE, and a cream SHEET rising out of it with a 32px top. On a
 * phone the stage is the strip above the sheet: the mark on a tab root, a
 * back control and a small caption on a focused screen. On a desktop the
 * stage is the whole canvas and the sheet is a panel floating on it.
 *
 *   nav="tabs"   — a tab root: the floating bar shows, and the sheet leaves
 *                  room for it
 *   nav={{back}} — a focused screen: a back disc, no bar
 *   nav="none"   — a signed-out door: the mark and nothing else
 *
 * The registry's `isFocusedRoute` / `isBareRoute` are the other half of that
 * decision, pinned by `nav.test.ts`.
 */
export type ScreenNav =
  "tabs" | "none" | { back: { href: string; label: string } };

export function Screen({
  children,
  nav = "tabs",
  stageLabel,
  stageActions,
  width = "md",
}: {
  children: ReactNode;
  nav?: ScreenNav;
  /** A small tracked caption centred in the stage header: "Manifest". */
  stageLabel?: string;
  /** Controls at the stage header's right edge. */
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
        <header
          className={cn(
            "relative flex h-16 items-center justify-between px-4",
            // The rail carries the mark on a desktop; a tab root has nothing
            // else to put here, so the strip goes.
            nav === "tabs" && "lg:hidden",
          )}
        >
          {back ? (
            <BackButton {...back} />
          ) : (
            <Wordmark tone="cream" className="h-9" priority />
          )}
          {stageLabel ? (
            <p className="label text-cream/70 absolute left-1/2 -translate-x-1/2">
              {stageLabel}
            </p>
          ) : null}
          <div className="flex gap-2">
            {stageActions ?? <span aria-hidden="true" className="size-11" />}
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
