/**
 * Answers this operator has just sent, until the Bookings count has shown
 * them go (O02 A, approved 4 Oct 2026).
 *
 * "The Bookings count rolls down" when the operator answers a request, and
 * only then. A request answered on another phone, or gone when the page
 * re-read, is a change this operator did not make, so the count cross-fades
 * as it does for every such change (O01 A). The two are told apart here: the
 * answer store marks each answer just before it is sent, and the count's next
 * fall takes the marks that account for it, once.
 *
 * Held in this module rather than in storage, on purpose (as the traveller's
 * `lib/booking/arrival.ts`): a reload, a re-read and a change made elsewhere
 * all draw the count as it is, and none of them replays a roll. An answer the
 * API refused takes its mark back; a mark nothing takes (the count not on
 * screen, or a new request landing in the same re-read) is forgotten after
 * `MARK_KEPT_MS`.
 */
const marks = new Map<number, number>();
let next = 0;

/**
 * How long a mark waits for the count to fall. The answer on one bar of
 * signal can take a while; a fall seen later than this simply cross-fades.
 */
export const MARK_KEPT_MS = 30_000;

/** The answer store, just before an answer is sent. Returns its mark. */
export function markAnswerSent(now: number = Date.now()): number {
  next += 1;
  marks.set(next, now);
  return next;
}

/** The answer store, when the answer did not go through: no fall to show. */
export function unmarkAnswerSent(mark: number): void {
  marks.delete(mark);
}

/**
 * The Bookings count, falling by `by`: is that this operator's answering?
 * Takes up to `by` marks, oldest first, so a second fall needs answers of its
 * own.
 */
export function takeAnswersSent(by: number, now: number = Date.now()): boolean {
  for (const [mark, at] of marks) {
    if (now - at > MARK_KEPT_MS) marks.delete(mark);
  }
  if (marks.size === 0) return false;
  let left = Math.max(1, by);
  for (const mark of marks.keys()) {
    if (left === 0) break;
    marks.delete(mark);
    left -= 1;
  }
  return true;
}
