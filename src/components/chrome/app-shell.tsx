"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { isBareRoute, type NavBadges } from "@/lib/site/nav";
import { ChromeProvider, type ChromeIdentity } from "./chrome-context";
import { NavList } from "./nav-items";
import { StageIdentity } from "./stage-identity";
import { TabBar } from "./tab-bar";

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
 * `badges` and `identity` are read on the server by the root layout
 * (yuvoy-operator#42, #80 t1, #96) and only drawn here. This component cannot
 * read them itself: it is a client component, and they come from
 * `/operator/v1`, which a browser is never allowed to call. `identity` is
 * handed to every screen's stage through `ChromeProvider`.
 */
export function AppShell({
  children,
  badges,
  identity = { businessName: null, canManage: false },
  banner,
}: {
  children: ReactNode;
  badges?: NavBadges;
  /** The business's name, the inbox count, and whether Money is drawn. */
  identity?: ChromeIdentity;
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
    <ChromeProvider identity={identity}>
      <div className="stage on-dark flex min-h-dvh flex-col lg:flex-row">
        <aside
          className={cn(
            "app-chrome border-paper/10 hidden w-64 shrink-0 flex-col border-r",
            !bare && "lg:sticky lg:top-0 lg:flex lg:h-dvh lg:overflow-y-auto",
          )}
        >
          {/*
            The compact mark and the business's name, and nothing else: the
            "For operators" caption under the marketing lockup went with the
            lockup (yuvoy-operator#80 t1). Everybody reading this is one.
          */}
          <div className="px-6 pt-7 pb-6">
            <StageIdentity size="rail" />
          </div>
          <nav aria-label="Primary" className="px-3">
            <NavList
              orientation="rail"
              badges={badges}
              canManage={identity.canManage}
            />
          </nav>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main id="main" className="flex min-w-0 flex-1 flex-col">
            {bare ? null : banner}
            {children}
          </main>
          <TabBar badges={badges} canManage={identity.canManage} />
        </div>
      </div>
    </ChromeProvider>
  );
}
