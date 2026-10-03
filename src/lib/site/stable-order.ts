/**
 * The server's order, with the rows it dropped that the screen still needs
 * left where they were.
 *
 * Home and Bookings draw lists the server re-renders on every focus and every
 * minute, and an answered request, a read message or a taken payment leaves
 * that list the moment the server knows. The receipt for it must not leave
 * with it ("accepted" read as "booked" is the misunderstanding the receipt is
 * there to stop), and it must not jump to the top either: the operator's
 * thumb is on the card they just answered, and an Undo that moves is an Undo
 * that is missed.
 *
 * So a kept key the server no longer sends is put back after the nearest row
 * that came before it last time, or first when nothing did. Pure, so it is
 * tested on its own; the caller keeps `previous` between renders.
 */
export function stableOrder(
  previous: readonly string[],
  server: readonly string[],
  kept: ReadonlySet<string>,
): string[] {
  const out = [...server];
  const present = new Set(server);
  previous.forEach((key, i) => {
    if (present.has(key) || !kept.has(key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) {
      const k = out.indexOf(previous[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, key);
    present.add(key);
  });
  return out;
}

/** Same keys, same order. */
export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}
