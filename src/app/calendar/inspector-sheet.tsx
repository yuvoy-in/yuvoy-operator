"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { markChange } from "@/lib/motion/mark";
import { Sheet } from "@/components/ui/sheet";
import { OnlineOnly } from "@/components/ui/online-only";

/**
 * Keeps the inspector on the page until it has left (O08 A, approved
 * 4 Oct 2026; the named integration change "held exits for the calendar
 * inspector").
 *
 * The board renders the inspector only while the address names a
 * departure, so the re-read that follows a close used to take it away in
 * the frame it landed, with no frames left to leave in. The board renders
 * this around it instead, always: while the server has stopped drawing the
 * inspector, the one it drew last stays mounted until its sheet says it has
 * gone. A refresh while it is open hands this the newer inspector, which is
 * the one drawn.
 */
const Presence = createContext<{ present: boolean; gone: () => void } | null>(
  null,
);

export function InspectorPresence({ children }: { children: ReactNode }) {
  const [held, setHeld] = useState<ReactNode>(children);
  if (children && children !== held) setHeld(children);
  const gone = useCallback(() => setHeld(null), []);
  const present = Boolean(children);
  const value = useMemo(() => ({ present, gone }), [present, gone]);
  const shown = children ?? held;
  return shown ? <Presence value={value}>{shown}</Presence> : null;
}

/**
 * The departures whose seats were saved while the inspector was open, so
 * their rows on the board can be marked as it goes (O08 A).
 */
const SeatsSaved = createContext<((id: string) => void) | null>(null);

/** Tells the inspector a departure's seats were saved; nothing elsewhere. */
export function useNoteSeatsSaved(): (id: string) => void {
  const note = useContext(SeatsSaved);
  return useCallback((id: string) => note?.(id), [note]);
}

/**
 * The board's inspector: everything about one departure, over the week it
 * was opened from (operator experiment B).
 *
 * The content is the server's, rendered for the departure the URL names; this
 * only frames it. A sheet from the bottom on a phone, a panel down the right
 * edge on a desktop.
 *
 * ## Closing answers the tap (O08 A, approved 4 Oct 2026)
 *
 * Closing used to be a navigation, so the sheet stayed up until the server
 * had answered it and then vanished in one frame. Now the sheet leaves on
 * the tap that closes it (the X, the backdrop, Escape): it goes back down
 * (150ms; it rose in 200ms), the address loses the departure at once, and
 * the board re-reads behind it, so Back, a refresh and a pasted link still
 * agree with what is on screen and the page does not jump to the top. A
 * step back or forward that leaves the departure sends the sheet away the
 * same way. As it goes, a row whose seats were saved in it carries the
 * forest mark (1.2s), where the eye lands next.
 *
 * With no signal the re-read cannot be fetched (Next would fall back to the
 * browser's "no internet" page), so offline only the address changes; the
 * board re-reads when the signal is back. Everything inside that changes
 * something is off until then (`OnlineOnly`); the close button is the
 * sheet's own and stays on.
 */
export function InspectorSheet({
  dep,
  title,
  closeHref,
  children,
}: {
  /** The departure this is about, as the address names it. */
  dep: string;
  title: ReactNode;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const presence = useContext(Presence);
  const named = useSearchParams().get("dep") === dep;

  /*
    Closed here, and gone: drawn again only once the address names this
    departure again, as a fresh sheet that rises again. Worked out while
    rendering, React's "storing information from previous renders".
  */
  const [closing, setClosing] = useState(false);
  const [closed, setClosed] = useState(false);
  const [openings, setOpenings] = useState(0);
  const [wasNamed, setWasNamed] = useState(named);
  if (named !== wasNamed) {
    setWasNamed(named);
    if (named && (closing || closed)) {
      setClosing(false);
      setClosed(false);
      setOpenings((n) => n + 1);
    }
  }
  const leaving = closing || !named || presence?.present === false;

  const close = useCallback(() => {
    setClosing(true);
    window.history.replaceState(null, "", closeHref);
    if (navigator.onLine) router.refresh();
  }, [router, closeHref]);

  const left = useCallback(() => {
    setClosed(true);
    presence?.gone();
  }, [presence]);

  // As it goes, the rows whose seats were saved in it are marked.
  const saved = useRef(new Set<string>());
  const note = useCallback((id: string) => saved.current.add(id), []);
  useEffect(() => {
    if (!leaving) return;
    for (const id of saved.current) {
      for (const row of document.querySelectorAll<HTMLElement>(
        "[data-departure]",
      )) {
        if (row.dataset.departure === id) markChange(row);
      }
    }
    saved.current.clear();
  }, [leaving]);

  if (closed) return null;
  return (
    <SeatsSaved value={note}>
      <Sheet
        key={openings}
        title={title}
        onClose={close}
        layout="inspector"
        motion="rise"
        leaving={leaving}
        onLeft={left}
      >
        <OnlineOnly>{children}</OnlineOnly>
      </Sheet>
    </SeatsSaved>
  );
}
