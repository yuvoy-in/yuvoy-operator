"use client";

import type { KeyboardEvent, ReactNode } from "react";

/**
 * Arrow keys across the board's grid, for a desktop with a keyboard
 * (operator experiment B).
 *
 * Every departure in the grid is a link, so Tab already reaches all of them
 * and Enter already opens one; the arrows are a shortcut on top, never the
 * only way. Left and right move a day, up and down a listing, to the nearest
 * departure in that direction. A key with nothing in its direction does
 * nothing rather than wrapping somewhere unexpected.
 *
 * The positions are read off the links (`data-row`, `data-col`) rather than
 * kept here, so the grid the server drew is the only truth about it.
 */
export function BoardKeys({ children }: { children: ReactNode }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    const move = moves[event.key];
    const from = event.target as HTMLElement;
    if (!move || from.dataset.row === undefined) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
      return;

    const row = Number(from.dataset.row);
    const col = Number(from.dataset.col);
    const links = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("[data-row][data-col]"),
    ).map((el) => ({
      el,
      row: Number(el.dataset.row),
      col: Number(el.dataset.col),
    }));

    const [dr, dc] = move;
    const ahead = links.filter((l) =>
      dr !== 0
        ? Math.sign(l.row - row) === dr
        : l.row === row && Math.sign(l.col - col) === dc,
    );
    // Nearest first: along the move, then across it.
    ahead.sort(
      (a, b) =>
        Math.abs(a.row - row) * (dr ? 1 : 10) +
        Math.abs(a.col - col) * (dc ? 1 : 10) -
        (Math.abs(b.row - row) * (dr ? 1 : 10) +
          Math.abs(b.col - col) * (dc ? 1 : 10)),
    );
    const next = ahead[0];
    if (!next) return;
    event.preventDefault();
    next.el.focus();
  }

  /*
    The handler is a shortcut over links that are each focusable and named;
    the wrapper itself is not a control and takes no focus.
  */
  return <div onKeyDown={onKeyDown}>{children}</div>;
}
