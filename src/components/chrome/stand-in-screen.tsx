"use client";

import type { ComponentProps } from "react";
import { usePathname } from "next/navigation";
import { screenNavFor } from "@/lib/site/nav";
import { Screen } from "./screen";

/**
 * A screen that stands in for whichever page was asked for: the error screen
 * and the missing page, which Next draws in a page's place on any route.
 *
 * Both wore a signed-out door's chassis everywhere (`nav="none"`). On a tab
 * root that swapped the strip to the bare mark, took the inbox away and left
 * no room for the bar, which stays on a tab root and covered the screen's
 * foot; on a screen gone into, the header swapped from the back disc's place
 * to the mark (the stability audit, P3-6). A stand-in cannot know its page,
 * but it can read the address the way the bar does and wear what the page
 * would have. Where back leads is the one thing it cannot know, so a focused
 * route keeps the disc's place, as its loading fallback does.
 */
export function StandInScreen(
  props: Omit<ComponentProps<typeof Screen>, "nav">,
) {
  const nav = screenNavFor(usePathname());
  return <Screen {...props} nav={nav} />;
}
