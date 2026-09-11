"use client";

import { usePathname } from "next/navigation";
import { isBareRoute, isFocusedRoute, type NavBadges } from "@/lib/site/nav";
import { NavList } from "./nav-items";

/**
 * The floating tab bar — a forest pill detached from the foot of the phone.
 * Absent on a focused screen, absent on a signed-out door, and absent from
 * `lg` up, where the rail takes over. The wrapper is inert so the strip
 * beside the pill still scrolls the page.
 *
 * ## Why the pill may scroll
 *
 * Five stops since yuvoy-operator#22, which is about 330px with the longest
 * label open. That fits every phone the suite runs on and every mainstream
 * handset; a 320px screen it does not.
 *
 * `max-w-full` plus `overflow-x-auto` is the whole guard: on a screen too
 * narrow the pill scrolls horizontally instead of clipping, so the worst case
 * is a nudge rather than a destination that cannot be reached at all. The
 * scrollbar is hidden because a scrollbar inside a 56px pill is noise, and
 * `overscroll-contain` stops a sideways drag on the bar from moving the page.
 */
export function TabBar({ badges }: { badges?: NavBadges }) {
  const pathname = usePathname();
  if (isFocusedRoute(pathname) || isBareRoute(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="tabbar-foot pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 lg:hidden"
    >
      <div className="app-chrome ring-cream/12 no-scrollbar pointer-events-auto max-w-full overflow-x-auto overscroll-x-contain rounded-full p-1.5 ring-1">
        <NavList orientation="bar" badges={badges} />
      </div>
    </nav>
  );
}
