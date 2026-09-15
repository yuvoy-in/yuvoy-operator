"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isBareRoute, type NavBadges } from "@/lib/site/nav";
import { NavList } from "./nav-items";
import { TabBar } from "./tab-bar";
import { Wordmark } from "@/components/ui/wordmark";

/**
 * The portal's chassis (v2.7).
 *
 * The forest stage is the ground on every viewport. On a phone each screen
 * stands a paper sheet on it and the floating bar sits over the foot; on a
 * desktop the navigation moves to a rail and each sheet becomes a panel.
 *
 * The rail is PINNED to the window; only the column beside it scrolls. As an
 * ordinary flex item it scrolled away, and every screen in this portal is long
 * enough for that to bite: all six measured taller than a 720px window, /team
 * at 2339px. An operator halfway down the team list had no navigation at all.
 * Being a flex item also stretched it to the DOCUMENT's height, so the rail
 * was 2339px of chrome to draw 250px of links.
 *
 * `sticky` rather than `fixed`: it keeps the rail in flow, so the row goes on
 * reserving its 256px and there is no padding on the sibling to keep in sync
 * with the width. `h-dvh` is what stops the stretch; `overflow-y-auto` is for
 * the short window where the rail's own contents do not fit. Both ride the
 * `!bare` group, because a signed-out door has no rail to pin.
 *
 * A signed-out door (`isBareRoute`) draws no rail and no bar: there is no
 * session to navigate with, and a rail whose every link bounces back to the
 * sign-in form is a rail that teaches somebody the portal is broken.
 *
 * `badges` are counted on the server by the root layout (yuvoy-operator#42)
 * and only drawn here. This component cannot read them itself: it is a client
 * component, and the counts come from `/operator/v1`, which a browser is never
 * allowed to call.
 */
export function AppShell({
  children,
  badges,
  banner,
}: {
  children: ReactNode;
  badges?: NavBadges;
  /**
   * The suspension banner, rendered by the server layout and placed here
   * (yuvoy-operator#50). It sits above `children` inside `main`, so it is the
   * first thing on every signed-in screen and it survives a screen below it
   * being restructured.
   *
   * Passed in rather than read here for the reason `badges` is: this is a
   * client component and the data comes from `/operator/v1`, which a browser
   * is never allowed to call.
   *
   * Not drawn on a bare route. A sign-in door has no session, so it has no
   * business telling anybody about an account.
   */
  banner?: ReactNode;
}) {
  const bare = isBareRoute(usePathname());

  return (
    <div className="stage on-dark flex min-h-dvh flex-col lg:flex-row">
      <aside
        className={cn(
          "app-chrome border-paper/10 hidden w-64 shrink-0 flex-col border-r",
          !bare && "lg:sticky lg:top-0 lg:flex lg:h-dvh lg:overflow-y-auto",
        )}
      >
        <div className="px-6 py-7">
          <Wordmark tone="paper" className="h-10" priority />
          <p className="label text-paper/70 mt-3">For operators</p>
        </div>
        <nav aria-label="Primary" className="px-3">
          <NavList orientation="rail" badges={badges} />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          {bare ? null : banner}
          {children}
        </main>
        <TabBar badges={badges} />
      </div>
    </div>
  );
}
