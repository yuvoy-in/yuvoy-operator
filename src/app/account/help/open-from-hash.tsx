"use client";

import { useEffect } from "react";

/**
 * Opens the answer a link pointed at: `/account/help#held-cash` lands on that
 * question with its answer showing.
 *
 * ## Why it runs after hydration and never on the server
 *
 * The fragment never reaches the server, so the page is rendered with every
 * answer closed, and it has to hydrate that way: a `<details>` drawn open on the
 * client's first render and closed on the server's is a hydration mismatch.
 * So the answers render identically on both sides, and this opens the one the
 * URL names once React has attached, by setting the element's own `open`. React
 * never manages that attribute here (no `open` prop is passed), so a later
 * re-render leaves it as the operator left it.
 *
 * `hashchange` covers a fragment that changes while the page is open. A
 * fragment that names nothing on the page, or names something that is not an
 * answer, is ignored.
 */
export function OpenFromHash() {
  useEffect(() => {
    const openNamed = () => {
      const id = fragmentId(window.location.hash);
      if (!id) return;
      const target = document.getElementById(id);
      if (!(target instanceof HTMLDetailsElement)) return;
      target.open = true;
      /*
        The router has already scrolled to it; opening changes nothing above it,
        so this only matters when the answer was reached by a fragment change on
        a page that was already open. Guarded because not every environment has
        it, and a missing scroll is not worth a thrown error.
      */
      target.scrollIntoView?.({ block: "start" });
    };

    openNamed();
    window.addEventListener("hashchange", openNamed);
    return () => window.removeEventListener("hashchange", openNamed);
  }, []);

  return null;
}

/**
 * `#held-cash` → `held-cash`; a fragment that will not decode names nothing.
 *
 * The LAST fragment only. After a hard load of `/account/help#cash-owed`, the
 * Next router appends that first fragment to later client navigations, so the
 * next link lands as `#cash-owed#settling-cash` (the same defect the app
 * guards on `/booking#t=A#t=B`; not fixed upstream as of 16.3.5). Reading the
 * whole of it found no answer and left it closed.
 */
export function fragmentId(hash: string): string {
  const raw = hash.split("#").pop() ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return "";
  }
}
