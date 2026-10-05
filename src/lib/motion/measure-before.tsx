"use client";

import { Component, type ReactNode } from "react";

/**
 * Reads the page just BEFORE a commit changes it, and hands that reading to
 * the moment just after.
 *
 * Every motion here that shows where something went (a list closing up, a
 * row arriving in another list, a confirm leaving where it stood) needs one
 * measurement taken while the old layout is still on screen. A function
 * component has no hook for that moment: by the time any effect runs, the
 * DOM has already changed. React's own answer is `getSnapshotBeforeUpdate`,
 * which runs before any mutation of the commit, and that is all this class
 * is: a function component wraps the part of its output that changes in it,
 * names what to `watch`, and gets `capture` before and `apply` after the
 * commit in which `watch` changed. `apply` runs before the browser paints,
 * so a motion that starts from the old reading never shows a frame of the
 * new layout first.
 *
 * Motion is decoration and must never take a screen down: a reading or a
 * motion that throws (an element gone mid-commit, an engine without an API)
 * is dropped, and the screen goes on exactly as it would have without it.
 */
export class MeasureBefore<T> extends Component<{
  /** The value whose change is a moment worth measuring. */
  watch: unknown;
  /** Read the page as it is now, before the commit. */
  capture: () => T;
  /** Use that reading, after the commit, before the paint. */
  apply: (before: T) => void;
  children?: ReactNode;
}> {
  getSnapshotBeforeUpdate(prev: Readonly<{ watch: unknown }>): {
    before: T;
  } | null {
    if (Object.is(prev.watch, this.props.watch)) return null;
    try {
      return { before: this.props.capture() };
    } catch {
      return null;
    }
  }

  componentDidUpdate(
    _props: unknown,
    _state: unknown,
    snapshot: { before: T } | null,
  ) {
    if (!snapshot) return;
    try {
      this.props.apply(snapshot.before);
    } catch {
      // See above: no motion rather than no screen.
    }
  }

  render() {
    return this.props.children ?? null;
  }
}
