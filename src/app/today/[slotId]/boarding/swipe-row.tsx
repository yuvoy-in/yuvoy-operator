"use client";

import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { CheckIcon } from "@/components/ui/icons";

/** How far a row must travel to check somebody in: 40% of it, at most 160px. */
export function commitDistance(width: number): number {
  return Math.min(160, width * 0.4);
}

/**
 * A row that checks somebody in when it is swiped to the right (operator
 * experiment D), with the row's own "Aboard" button as its visible twin: a
 * gesture is never the only way to do anything.
 *
 * Touch and pen only. A mouse drags text, and a desktop has the button. The
 * gesture claims the pointer only once it is clearly sideways, so scrolling
 * the list is never mistaken for a check-in, and the tap that a finished
 * drag would end in never opens the party's sheet. Under the row, what
 * letting go will do: "Keep going", then "Let go: aboard".
 */
export function SwipeRow({
  enabled,
  onCommit,
  children,
}: {
  enabled: boolean;
  onCommit: () => void;
  children: ReactNode;
}) {
  const [dx, setDx] = useState(0);
  const [width, setWidth] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const dragging = useRef(false);
  const swallowClick = useRef(false);

  function down(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || event.pointerType === "mouse") return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    dragging.current = false;
    setWidth(event.currentTarget.getBoundingClientRect().width);
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const from = start.current;
    if (!from || event.pointerId !== from.id) return;
    const x = event.clientX - from.x;
    const y = event.clientY - from.y;
    if (!dragging.current) {
      if (x > 12 && Math.abs(x) > Math.abs(y) * 1.5) {
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      } else if (Math.abs(y) > 12 || x < -12) {
        // A scroll, or a swipe the other way: not ours.
        start.current = null;
        return;
      }
    }
    if (dragging.current) setDx(Math.max(0, x));
  }

  function up() {
    const wasDragging = dragging.current;
    start.current = null;
    dragging.current = false;
    if (!wasDragging) return;
    swallowClick.current = true;
    if (dx >= commitDistance(width)) onCommit();
    setDx(0);
  }

  const armed = dx >= commitDistance(width) && dx > 0;

  return (
    <div className="rounded-card relative overflow-hidden">
      {dx > 0 ? (
        <div
          aria-hidden="true"
          className="bg-forest text-paper absolute inset-0 flex items-center gap-2 px-5 text-base font-bold"
        >
          <CheckIcon className="size-6" />
          {armed ? "Let go: aboard" : "Keep going"}
        </div>
      ) : null}
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => {
          start.current = null;
          dragging.current = false;
          setDx(0);
        }}
        onClickCapture={(event) => {
          if (!swallowClick.current) return;
          swallowClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }}
        style={dx > 0 ? { transform: `translateX(${dx}px)` } : undefined}
        className={cn(
          "relative touch-pan-y",
          dx === 0 && "ease-interaction transition-transform duration-200",
        )}
      >
        {children}
      </div>
    </div>
  );
}
