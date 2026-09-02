/**
 * Which file an upload slot belongs to.
 *
 * An upload intent is one per operator and is not tied to a file — the API
 * hands out a URL and never learns what is going into it. The client is the
 * only party that knows, and for a while it forgot: the slot was kept across
 * file changes "so a different clip reuses the one we hold", and tus resumes
 * from the SERVER's offset. So after a partial upload of clip A stopped, a
 * newly chosen clip B carried on from A's offset — A's first megabytes with
 * B's tail, confirmed, attested and sent to review as one corrupt reel. A
 * smaller B claimed success while the server waited forever for bytes that
 * would never come; a larger B re-sent the same chunk in a loop.
 *
 * The rule is small and pure so it can be tested without a browser: a slot
 * that holds bytes of one file takes no other file until it is finished or
 * has expired. Same file again — the name, the size and the modification
 * time all agreeing — carries on from where the server says it got to.
 */

export interface FileIdentity {
  name: string;
  size: number;
  lastModified: number;
}

export function identityOf(file: File): FileIdentity {
  return { name: file.name, size: file.size, lastModified: file.lastModified };
}

export function sameFile(a: FileIdentity, b: FileIdentity): boolean {
  return (
    a.name === b.name && a.size === b.size && a.lastModified === b.lastModified
  );
}

export type SlotDecision =
  /** Nothing of another file has landed. The slot may take this one. */
  | { kind: "fresh" }
  /** The same file, continuing from the server's offset. */
  | { kind: "resume"; uploaded: number }
  /**
   * Another file's bytes are on the server — or we could not find out, which
   * is treated the same way, because "probably fine" is how a corrupt reel
   * reaches a traveller's screen.
   */
  | { kind: "held"; by: FileIdentity; uploaded: number | null };

/**
 * @param bound   The file whose bytes were sent to this slot, if any.
 * @param picked  The file just chosen.
 * @param serverOffset  What `HEAD` said the server holds; null if it could
 *                      not be asked.
 */
export function decideSlot(
  bound: FileIdentity | null,
  picked: FileIdentity,
  serverOffset: number | null,
): SlotDecision {
  if (!bound) return { kind: "fresh" };
  if (sameFile(bound, picked)) {
    return { kind: "resume", uploaded: serverOffset ?? 0 };
  }
  // A different file, but nothing of the first one ever landed: the slot is
  // clean and may be rebound. Only a confirmed zero counts as clean.
  if (serverOffset === 0) return { kind: "fresh" };
  return { kind: "held", by: bound, uploaded: serverOffset };
}
