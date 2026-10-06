/**
 * Everything on the page but one element, made inert while that element is
 * open over it (the stability audit, P3-5).
 *
 * A sheet says `aria-modal`, and it is a `div` rather than a `<dialog>` (see
 * `Sheet` for why), so the saying was all there was: Tab walked off its last
 * control into the page behind it, and a screen reader's swipe did the same.
 * A modal `<dialog>` makes the rest of the page inert; this does it by hand,
 * the same way: every sibling of the element, and of each of its ancestors up
 * to the body, is made `inert` until the release is called.
 *
 * The page goes on drawing behind an open sheet (a re-read lands, a banner
 * comes up), and what it puts beside the way up to the sheet would otherwise
 * arrive within reach. So the way up is watched while the sheet is open, and
 * what arrives on it is made inert as it lands. What arrives inside something
 * inert already is inert with it.
 *
 * Only what this made inert is given back, so an element that was inert
 * already (a sheet on its way out) stays as it was. Sheets here never open
 * over one another; one that did would find the page already inert, and
 * leave it so.
 */
export function inertOthers(keep: Element): () => void {
  const made: Element[] = [];
  const way = new Set<Element>();
  const parents: Element[] = [];
  let node: Element = keep;
  while (node !== document.body && node.parentElement) {
    const parent: Element = node.parentElement;
    way.add(node);
    parents.push(parent);
    node = parent;
  }

  const quiet = (element: Element) => {
    if (way.has(element) || element.hasAttribute("inert")) return;
    element.setAttribute("inert", "");
    made.push(element);
  };
  for (const parent of parents) {
    for (const child of Array.from(parent.children)) quiet(child);
  }

  const watch = new MutationObserver((changes) => {
    for (const change of changes) {
      for (const added of Array.from(change.addedNodes)) {
        if (added instanceof Element) quiet(added);
      }
    }
  });
  for (const parent of parents) watch.observe(parent, { childList: true });

  let released = false;
  return () => {
    if (released) return;
    released = true;
    watch.disconnect();
    for (const element of made) element.removeAttribute("inert");
  };
}
