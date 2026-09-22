"use client";

import { usePathname } from "next/navigation";
import { isBareRoute, isFocusedRoute, type NavBadges } from "@/lib/site/nav";
import { NavList } from "./nav-items";

/**
 * The floating tab bar: a forest pill detached from the foot of the phone.
 * Absent on a focused screen, absent on a signed-out door, and absent from
 * `lg` up, where the rail takes over. The wrapper is inert so the strip
 * beside the pill still scrolls the page.
 *
 * ## Five labelled stops across the width (yuvoy-operator#80 t6, #96)
 *
 * The pill spans the phone, less a 16px gutter each side, and its stops share
 * that width equally, each with its word under its glyph. That is about 60px
 * a stop on a 360px phone and more on anything wider, enough for the longest
 * word at 11px, so nothing scrolls and no destination is out of reach. It
 * stops growing at 28rem, where a wider bar would only put the stops further
 * from the thumb.
 */
export function TabBar({
  badges,
  canManage = false,
}: {
  badges?: NavBadges;
  /** OWNER, ADMIN or MANAGER: whether the Money stop is drawn. */
  canManage?: boolean;
}) {
  const pathname = usePathname();
  if (isFocusedRoute(pathname) || isBareRoute(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="tabbar-foot pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 lg:hidden"
    >
      <div className="app-chrome ring-paper/12 pointer-events-auto w-full max-w-md rounded-full p-1.5 ring-1">
        <NavList orientation="bar" badges={badges} canManage={canManage} />
      </div>
    </nav>
  );
}
