"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import { useOnline, useSettledOnline } from "@/components/ui/use-online";
import { panelClass } from "@/components/ui/panel";

/**
 * A screen that stays readable with no signal, and says so (the Calendar's
 * offline state, operator experiment B, approved 3 Oct 2026).
 *
 * The board is server-rendered: with no signal there is no next week, no
 * other day and no inspector to fetch, and Next falls back to a full browser
 * navigation when it cannot fetch one, which lands on the browser's own
 * "no internet" page and takes the board the operator was reading with it.
 * So while the phone is offline a link to another page of this app is held
 * where it is, and the notice says it opens once the signal is back. Phone,
 * mail, new-tab and same-page links still work: none of them needs us.
 *
 * Writes are switched off by `OnlineOnly` around them; this only explains,
 * in a status region that is always mounted so a screen reader hears the
 * change, and stays in view while the page scrolls.
 *
 * The notice follows the signal once it has held for a moment
 * (`useSettledOnline`): it sits in the flow, so a connection that flapped
 * moved the whole board under the operator's thumb with each blip. A link
 * held for no signal is said at once, settled or not: a tap that does nothing
 * must say why.
 */
export function ReadOnlyWhenOffline({
  what,
  children,
}: {
  /** "The calendar": the subject of the notice. */
  what: string;
  children: ReactNode;
}) {
  const online = useOnline();
  const { held, onClickCapture } = useHeldLinks(online);
  const offline = !useSettledOnline() || held;

  return (
    <div onClickCapture={onClickCapture}>
      <div
        role="status"
        className={offline ? "sticky top-2 z-20 mt-6" : "sr-only"}
      >
        {offline ? (
          <div className={panelClass("alert", "p-4")}>
            <p className="text-terra-deep text-base font-bold text-balance">
              No signal
            </p>
            {/* A real space: read out, the two lines must not run together. */}{" "}
            <p className="text-forest/80 leading-body mt-1 text-sm text-pretty">
              {what} is read-only until you are back online. What it shows may
              be out of date.
              {held ? " That opens once you are back online." : null}
            </p>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/**
 * Holds a link to another page of this app while there is no signal, and says
 * whether one was held, so the screen can add "That opens once you are back
 * online." Put `onClickCapture` on an element around the links.
 */
export function useHeldLinks(online: boolean): {
  held: boolean;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
} {
  const [held, setHeld] = useState(false);
  // Back online: the next time it drops, the notice starts plain again.
  if (online && held) setHeld(false);
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (online) return;
    if (!pageLink(event.target)) return;
    // Before Next's own link handler, which skips a prevented click.
    event.preventDefault();
    setHeld(true);
  };
  return { held, onClickCapture };
}

/**
 * The link a click landed on, when following it needs this app's server: the
 * same origin, this tab, and somewhere other than a spot on this page.
 */
export function pageLink(target: EventTarget | null): HTMLAnchorElement | null {
  if (!(target instanceof Element)) return null;
  const link = target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return null;
  if (link.target && link.target !== "_self") return null;
  if (link.hasAttribute("download")) return null;
  let url: URL;
  try {
    url = new URL(link.href, window.location.href);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== window.location.origin) return null;
  const here = window.location;
  if (
    url.hash &&
    url.pathname === here.pathname &&
    url.search === here.search
  ) {
    return null;
  }
  return link;
}
