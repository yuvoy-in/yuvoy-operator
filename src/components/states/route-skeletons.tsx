import { Screen, type ScreenNav } from "@/components/chrome/screen";
import { Skeleton } from "@/components/ui/states";

/**
 * The route-level fallbacks — what a `loading.tsx` renders.
 *
 * ## Why these exist at all
 *
 * Every route in this portal is `force-dynamic`, because every one of them
 * calls `requireOperator()` and reads the session cookie. That is correct and
 * unavoidable for an authenticated portal. What was not correct is that not
 * one of the thirty-one had a loading boundary, and for a dynamic route that
 * combination has two documented consequences:
 *
 *   - **Next skips prefetching a dynamic route entirely** unless it finds a
 *     `loading.tsx` to prefetch. With none anywhere, no tap in this portal was
 *     ever prefetched — every one started from cold.
 *   - **With no Suspense boundary, the router paints nothing while it waits.**
 *     The previous screen stays on the glass until the new one has finished
 *     rendering on the server, and Home alone reads seven things before it can
 *     render. On a dock on one bar of signal that is a tap that appears to do
 *     nothing, which is exactly what was reported.
 *
 * A boundary fixes both: the route becomes partially prefetchable, and the
 * fallback paints in the first frame after the tap.
 *
 * ## Chassis-first, so the swap moves nothing
 *
 * The fallback draws the real `Screen` — same stage, same sheet, same measure
 * — and puts skeletons only where content goes. The frame is already in its
 * final position when the content lands. A centred spinner would paint and
 * then be replaced by a different layout, which reads as two loads.
 *
 * ## One per chassis, not one per route
 *
 * The portal has three chassis and so three fallbacks here: a tab root, a
 * focused screen, and the chrome-less doors. Which one a route wears is
 * already decided by `FOCUSED_ROUTE_PREFIXES` and `BARE_ROUTE_PREFIXES` in the
 * nav registry, so the boundaries are placed to agree with it and
 * `loading.test.ts` pins that they do — a route whose chassis changes in the
 * registry and not here would paint the wrong frame for a moment on every tap.
 */

/**
 * The stage-and-sheet chassis — every screen behind the session.
 *
 * `nav` defaults to `"tabs"`, which is right for the four tab roots and is the
 * only thing a fallback can honestly assume. A focused screen's back control
 * is not drawn: a fallback cannot know where back leads, and a disc that
 * flashes the wrong destination is worse than one that arrives with the
 * screen. The strip is the same height either way, so nothing below it moves.
 */
export function SheetSkeleton({
  nav = "tabs",
  width = "md",
  rows = 3,
}: {
  nav?: ScreenNav;
  width?: "sm" | "md" | "lg";
  /** How many content blocks to stand in for. */
  rows?: number;
}) {
  return (
    <Screen nav={nav} width={width}>
      <div role="status" aria-busy="true" aria-label="Loading">
        <span className="sr-only">Loading</span>
        <div className="space-y-6">
          <div className="space-y-3">
            <Skeleton className="h-3 w-24 rounded-full" />
            <Skeleton className="h-8 w-2/3 rounded-full" />
          </div>
          <div className="space-y-3">
            {Array.from({ length: rows }, (_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        </div>
      </div>
    </Screen>
  );
}

/**
 * A screen an operator goes INTO: no tab bar, so no clearance for one.
 *
 * `nav="none"` is what the real focused screens differ from only by the back
 * disc, which a fallback cannot draw because it cannot know where back leads.
 * The header height, the sheet and the `pb-8` foot are all identical, so the
 * content lands exactly where the skeleton stood.
 */
export function FocusedSkeleton({
  width = "md",
  rows = 3,
}: {
  width?: "sm" | "md" | "lg";
  rows?: number;
}) {
  return <SheetSkeleton nav="none" width={width} rows={rows} />;
}

/**
 * The three doors — sign in, sign up, accept an invitation.
 *
 * They draw the mark and nothing else, so their fallback must too. Given the
 * tab-bar chassis instead, the skeleton would paint a sheet and a clearance
 * for a bar that is not coming, and the real screen would then throw both
 * away. `nav="none"` is the same declaration those pages make themselves.
 */
export function DoorSkeleton() {
  return <SheetSkeleton nav="none" width="sm" rows={1} />;
}
