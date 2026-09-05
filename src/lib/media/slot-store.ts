/**
 * What the browser remembers about the upload slot across a reload.
 *
 * ## What is stored, and what must never be
 *
 * An intent id and a file's **identity** — name, size, modification time.
 * Never the `uploadUrl`. The contract is explicit that it is "a credential for
 * writing video into our account … do not persist it client-side either", and
 * since yuvoy-api#66 §3 there is no reason to want to: the API hands the URL
 * back on request, derived rather than stored, so remembering it would trade a
 * real security property for nothing.
 *
 * The identity is not a credential. It is three facts about a file already on
 * this device, readable by the person who put it there, and it is the only
 * thing that lets a reloaded page tell "carry on with your clip" from "that is
 * somebody else's upload". See `slot.ts` for why that distinction is the whole
 * point.
 *
 * ## Why `localStorage` and not `sessionStorage`
 *
 * `sessionStorage` dies with the tab, and the tab dying is precisely the case
 * this exists for — "close the app, come back, and have it finish" is O8's
 * acceptance criterion, not an edge case.
 *
 * ## Why every call is wrapped
 *
 * Storage throws rather than returns null in several real situations: Safari
 * private browsing, a browser set to block site data, a full quota. On a phone
 * on a jetty those are not hypothetical. A throw here would take out the
 * upload screen, and the upload works without the memory — it just falls back
 * to the server's declared length, which `decideSlot` handles. So every path
 * degrades to "we do not remember" rather than to an error.
 */

import type { FileIdentity } from "./slot";

/*
  Versioned, because the shape is read by code that may be older or newer than
  the code that wrote it — a phone that has not reloaded the app in a week is
  the normal case, not the exotic one. A shape change bumps the key rather than
  trying to migrate one record nobody would miss.
*/
const KEY = "yuvoy.operator.upload-slot.v1";

interface StoredSlot {
  intentId: string;
  identity: FileIdentity;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Remember which file went into this intent. Call it before the first byte. */
export function rememberSlot(intentId: string, identity: FileIdentity): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY, JSON.stringify({ intentId, identity }));
  } catch {
    /* Quota, or storage disabled. The upload does not depend on this. */
  }
}

/**
 * What went into this intent, if this browser is the one that put it there.
 *
 * Keyed on the intent id rather than read blindly: a record left over from a
 * finished or expired upload names a file that has nothing to do with the slot
 * being handed out now, and a stale identity is worse than none — it would
 * make `decideSlot` confident about the wrong file rather than cautious about
 * an unknown one.
 */
export function recallSlot(intentId: string): FileIdentity | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSlot>;
    if (parsed?.intentId !== intentId) return null;
    const id = parsed.identity;
    /*
      Validated field by field rather than trusted. This is data from disk that
      any script on this origin could have written, and a malformed identity
      would flow straight into a resume decision.
    */
    if (
      !id ||
      typeof id.name !== "string" ||
      typeof id.size !== "number" ||
      typeof id.lastModified !== "number" ||
      !Number.isFinite(id.size) ||
      !Number.isFinite(id.lastModified)
    ) {
      return null;
    }
    return { name: id.name, size: id.size, lastModified: id.lastModified };
  } catch {
    return null;
  }
}

/**
 * Forget the binding, once the slot it described is finished with.
 *
 * Left behind, the record would name a file for an intent id that will never
 * come back — harmless, since `recallSlot` matches on the id, but it is the
 * operator's file name sitting on their device for no reason.
 */
export function forgetSlot(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(KEY);
  } catch {
    /* Nothing to do, and nothing depends on it. */
  }
}
