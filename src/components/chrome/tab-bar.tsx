"use client";

import { usePathname } from "next/navigation";
import { isBareRoute, isFocusedRoute } from "@/lib/site/nav";
import { NavList } from "./nav-items";

/**
 * The floating tab bar — a forest pill detached from the foot of the phone.
 * Absent on a focused screen, absent on a signed-out door, and absent from
 * `lg` up, where the rail takes over. The wrapper is inert so the strip
 * beside the pill still scrolls the page.
 */
export function TabBar() {
  const pathname = usePathname();
  if (isFocusedRoute(pathname) || isBareRoute(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="tabbar-foot pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 lg:hidden"
    >
      <div className="app-chrome ring-cream/12 pointer-events-auto rounded-full p-1.5 ring-1">
        <NavList orientation="bar" />
      </div>
    </nav>
  );
}
