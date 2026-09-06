"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType } from "react";
import { cn } from "@/lib/cn";
import { NAV, type NavIcon } from "@/lib/site/nav";
import {
  BriefcaseIcon,
  CalendarIcon,
  ClockIcon,
  LayersIcon,
  TicketIcon,
} from "@/components/ui/icons";

const ICONS: Record<NavIcon, ComponentType<{ className?: string }>> = {
  today: CalendarIcon,
  requests: ClockIcon,
  capacity: TicketIcon,
  services: LayersIcon,
  business: BriefcaseIcon,
};

/**
 * The floating tab bar (phone) and the rail (desktop) render the same
 * registry in two orientations. In the bar the active destination opens into
 * a cream pill carrying its name; the other four are discs holding only
 * their glyph, named for a screen reader.
 *
 * ## Five stops, and the width that buys
 *
 * Four discs at 48px, one open pill, `gap-1` between and `p-1.5` around comes
 * to roughly 330px with the longest label. That fits the 412px the mobile
 * suite runs at and a 360px phone; below 360px it would not, and the pill
 * scrolls rather than clipping — `overflow-x-auto` with the scrollbar hidden,
 * so the worst case is a nudge rather than a destination nobody can reach.
 */
export function NavList({ orientation }: { orientation: "bar" | "rail" }) {
  const pathname = usePathname() ?? "";
  const bar = orientation === "bar";

  return (
    <ul className={cn("flex", bar ? "items-center gap-1" : "flex-col gap-1")}>
      {NAV.map((item) => {
        const active = item.match(pathname);
        const Icon = ICONS[item.icon];
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "ease-interaction flex h-12 items-center rounded-full transition-[background-color,color] duration-200",
                bar
                  ? active
                    ? "bg-cream text-forest gap-2 pr-4 pl-3.5"
                    : "text-cream/70 hover:text-cream w-12 justify-center"
                  : active
                    ? "bg-cream text-forest gap-3 px-4"
                    : "text-cream/70 hover:bg-cream/8 hover:text-cream gap-3 px-4",
              )}
            >
              <Icon className="size-5" />
              <span
                className={cn(
                  "label font-bold",
                  bar && "text-[11px]",
                  bar && !active && "sr-only",
                )}
              >
                {item.label}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
