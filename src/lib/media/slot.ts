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
 * ## Why this got harder, not easier, when the API improved
 *
 * yuvoy-api#66 §3 (PR #85) made `POST /media/upload-intents` **return the
 * upload already in flight** instead of a 409. That is what makes O8's own
 * acceptance criterion — "close the app, come back, and have it finish" —
 * reachable at all, and it is the right change.
 *
 * It also made the corrupt reel above reachable across a reload. Before it, a
 * page that had just loaded could not obtain a URL for an upload in progress,
 * so "the slot holds bytes and this page does not know whose" was not a state
 * that existed. Now it is the *normal* state after a restart: the URL comes
 * back, and the page it comes back to remembers nothing.
 *
 * So the rule below can no longer be "no binding means a clean slot". A slot
 * is clean when the SERVER says it holds nothing, and at no other time.
 *
 * ## The three ways we can know whose bytes those are
 *
 * 1. **`bound`** — this page watched the bytes go in. Strongest, and gone on
 *    reload.
 * 2. **`remembered`** — the same browser watched them go in, before the
 *    reload. `slot-store.ts`, and it stores an identity, never the URL.
 * 3. **`declaredLength`** — the server's own statement of how big the file it
 *    is holding is. Weakest and the only one that survives cleared storage or
 *    a different device, and enough on its own only because two different
 *    video files agreeing to the byte is not a thing that happens.
 *
 * When none of them can identify it, the slot is **held**. That direction is
 * chosen deliberately: a wrong "held" costs the operator a wait, and a wrong
 * "fresh" costs a corrupt reel that a human reviewer has to watch, with a
 * signed rights attestation on it.
 *
 * The rule is small and pure so it can be tested without a browser.
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

/** What `HEAD` on the upload URL said. See `readUploadState`. */
export interface ServerSlot {
  offset: number;
  declaredLength: number | null;
}

export type SlotDecision =
  /** The server holds nothing. The slot may take this file. */
  | { kind: "fresh" }
  /** This file, continuing from the server's offset. */
  | { kind: "resume"; uploaded: number }
  /**
   * Somebody's bytes are on the server and they are not this file's — or we
   * cannot show that they are, which is treated the same way, because
   * "probably fine" is how a corrupt reel reaches a traveller's screen.
   *
   * `by` is null when the bytes cannot be named: another device, another
   * person at the same business, or storage that was cleared. The screen says
   * a different thing in that case, because "choose X again" is no help when
   * nothing knows what X was.
   */
  | { kind: "held"; by: FileIdentity | null; uploaded: number | null }
  /**
   * The upload server could not be asked. Not a slot conflict and not
   * something to guess past: the upload itself starts with the same `HEAD`, so
   * it would fail a moment later anyway, and saying so here is the honest
   * version of the same refusal.
   */
  | { kind: "unreachable" };

/**
 * @param known   The file whose bytes went into this slot, if anything knows:
 *                what this page watched, or what this browser remembers.
 * @param picked  The file just chosen.
 * @param server  What `HEAD` said; null if it could not be asked.
 */
export function decideSlot(
  known: FileIdentity | null,
  picked: FileIdentity,
  server: ServerSlot | null,
): SlotDecision {
  if (!server) return { kind: "unreachable" };

  /*
    Nothing has landed, so nothing can be corrupted. This is the ONLY condition
    under which a slot is clean — not "we have no binding", which is what a
    reloaded page always looks like since the intent started coming back.
  */
  if (server.offset === 0) return { kind: "fresh" };

  const { declaredLength } = server;
  const sizeMatches =
    declaredLength !== null ? declaredLength === picked.size : null;

  if (known) {
    /*
      The server's word beats ours. If it is holding a file of a different size
      from the one we think we bound, our record is stale or belongs to another
      upload entirely, and acting on it would resume into the wrong file with
      more confidence than a page that knew nothing.
    */
    if (sameFile(known, picked) && sizeMatches !== false) {
      return { kind: "resume", uploaded: server.offset };
    }
    return {
      kind: "held",
      by: sameFile(known, picked) ? null : known,
      uploaded: server.offset,
    };
  }

  /*
    Nobody remembers. The server's declared length is all there is, and it is
    enough only when it matches exactly: this is the operator who cleared their
    site data, or came back on the laptop, and it is the difference between
    finishing their upload and waiting an hour for an intent to expire.
  */
  if (sizeMatches === true) return { kind: "resume", uploaded: server.offset };
  return { kind: "held", by: null, uploaded: server.offset };
}
