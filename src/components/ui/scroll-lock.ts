/**
 * The page holding still behind whatever is open over it, counted.
 *
 * A sheet hides the page's overflow so the grid it was opened from keeps its
 * place. It used to save what it found and put that back on close, which
 * goes wrong the moment two are open: the second saves the first one's
 * "hidden", and when they close in the opposite order the page is left
 * unable to scroll at all (the stability audit, P2-6). So the page is held
 * while anything holds it, and given back once, as it was, by the last.
 */
let holders = 0;
let before = "";

/** Hold the page still. Returns the release, which only ever counts once. */
export function lockScroll(): () => void {
  if (holders === 0) {
    before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  holders += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) document.body.style.overflow = before;
  };
}
