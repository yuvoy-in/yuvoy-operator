/**
 * The seat counts an operator has just sent, held until the board draws them
 * (O08 A, approved 4 Oct 2026).
 *
 * The desktop board's fill bar grows from the left when the operator saves a
 * departure's seats, and only then: a fill that changes because somebody
 * booked, or because another login saved, is a change this operator did not
 * make, and the portal marks those rather than moving them. So "Set seats"
 * notes the count it is about to send, and the bar takes the note when the
 * board it re-reads draws that count, once.
 *
 * Held in this module rather than in storage, on purpose (as the traveller's
 * `lib/booking/arrival.ts`): a reload, a later re-read and another screen all
 * draw the board as it is, and none of them replays a growth. A note nothing
 * takes (a save made on the listing hub, where there is no board) is
 * forgotten after `NOTE_KEPT_MS`.
 */
const notes = new Map<string, { seats: number; at: number }>();

/**
 * How long a note waits for the board to draw it. The answer on one bar of
 * signal can take a while; a count drawn later than this simply changes.
 */
export const NOTE_KEPT_MS = 30_000;

/** "Set seats": this departure's seats are about to be sent as `seats`. */
export function noteSeatsSent(
  departure: string,
  seats: number,
  now: number = Date.now(),
): void {
  notes.set(departure, { seats, at: now });
}

/**
 * The board: is `seats` the count this operator just sent for `departure`?
 * Taken once: a second reading of the same count answers no.
 */
export function takeSeatsSent(
  departure: string,
  seats: number,
  now: number = Date.now(),
): boolean {
  const note = notes.get(departure);
  if (!note) return false;
  if (now - note.at > NOTE_KEPT_MS) {
    notes.delete(departure);
    return false;
  }
  if (note.seats !== seats) return false;
  notes.delete(departure);
  return true;
}

/** "Set seats", refused: nothing it sent will be drawn. */
export function forgetSeatsSent(departure: string): void {
  notes.delete(departure);
}
