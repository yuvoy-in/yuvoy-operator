import { credentialTypeLabel } from "@/lib/profile/credentials";
import { verifiedWithoutFile } from "./standing";

/**
 * Required documents, and the file behind one — yuvoy-operator#46 items 1 to 3.
 *
 * ## Why the count is read and not computed
 *
 * `requiredDocuments` exists "so a screen can say '5 of 6' rather than guess
 * the 6", and the 6 is not guessable: it is "what your market requires of every
 * business, plus what the categories and activities you have published listings
 * in require, so it can grow when a listing in a new category is approved." A
 * portal counting the credential rows it can see would answer a different
 * question and be wrong the day a listing is approved in a new category.
 *
 * ## Only a PENDING document takes a file
 *
 * "Once somebody at Yuvoy has verified or rejected a document, a new file
 * behind it would change the evidence under a decision nobody re-made", which
 * answers `409 document_locked`. So the control is withheld on every other
 * state rather than offered and refused.
 *
 * That includes a VERIFIED document we hold no file for (yuvoy-operator#93).
 * The review asked for "Send the file" on those too, and the pinned API
 * answers it the other way (D56): "our staff can put a file behind a verified
 * document that has none: the file we already hold for it". The operator's
 * own upload still answers `409 document_locked` for any state but pending,
 * checked in the handler at e7291e3. So the row says we hold no file and asks
 * for a copy by the one route that can take it, rather than offering a
 * control that is refused the day a documents bucket exists.
 */

export interface RequiredDocument {
  type: string;
  satisfied: boolean;
}

export interface Blocker {
  code: string;
  label: string;
}

/** "5 of 6 required documents are verified", or nothing to say. */
export function documentCount(
  required: readonly RequiredDocument[],
): string | null {
  // "Not drawn when `requiredDocuments` is empty" — a business with nothing
  // required would otherwise read "0 of 0 verified", which sounds like a fault.
  if (required.length === 0) return null;
  const met = required.filter((d) => d.satisfied).length;
  return `${met} of ${required.length} required documents are verified`;
}

/**
 * The blocker that explains an unsatisfied document.
 *
 * "A document that is not satisfied always has a `CREDENTIAL_*` entry in
 * `blocking` saying why." Matched on the type appearing in the blocker's code,
 * because the codes are `CREDENTIAL_MISSING` / `CREDENTIAL_EXPIRED` and carry
 * the type in their `label` rather than in a field of their own — so the label
 * is what is matched against, lower-cased, with the type's underscores loosened
 * to spaces so `instructor_cert` finds "Instructor certificate".
 *
 * `null` when nothing matches, and the row then says nothing extra: inventing a
 * reason for a document is worse than leaving the count to speak.
 */
export function blockerFor(
  type: string,
  blocking: readonly Blocker[],
): Blocker | null {
  const label = credentialTypeLabel(type).toLowerCase();
  const loose = type.replace(/_/g, " ").toLowerCase();
  return (
    blocking.find((b) => {
      if (!b.code.startsWith("CREDENTIAL")) return false;
      const text = (b.label ?? "").toLowerCase();
      return text.includes(label) || text.includes(loose);
    }) ?? null
  );
}

/** What a document row says about its file. Never a blank. */
export function fileLine(credential: {
  state?: string;
  hasFile?: boolean;
  filename?: string;
}): string {
  /*
    A verified document with no file is said from OUR side, because it is our
    gap: we verified it, so "No file sent" would read as the operator's
    omission, and the operator may well have shown it to us some other way
    (yuvoy-operator#93).
  */
  if (verifiedWithoutFile(credential)) return "We hold no file for it";
  /*
    `hasFile` decides it, not the filename being present. A response with a name
    and no flag is one disagreeing with itself, and showing the name would tell
    an operator we hold a file we may not.
  */
  if (credential.hasFile !== true) return "No file sent";
  const name = (credential.filename ?? "").trim();
  return name === "" ? "A file is on record" : name;
}

/** Whether this document will take a file at all. */
export function takesFile(state: string | undefined): boolean {
  return state === "pending";
}

/**
 * `503 documents_unavailable`: no documents store is configured on this
 * service, which is production today (an owner item). It is a state, not a
 * failure: nothing is wrong with the file, nothing the operator does changes
 * it, and "try again" would have them retrying for weeks (yuvoy-operator#93).
 */
export const DOCUMENTS_SWITCHED_OFF =
  "Sending files is switched off for now. Nothing to do on your side.";

/* ------------------------------------------------- what may be sent ------ */

/** 10 MB, the contract's own ceiling. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

/**
 * Why this file cannot be sent, or `null`.
 *
 * Checked BEFORE the intent, which the issue asks for and which is not only
 * politeness: "the size and the kind are signed into the URL, so the bucket
 * itself refuses a file of any other length or content type." An oversized file
 * would be uploaded in full and then refused, on an island connection, and the
 * operator would have spent the upload to be told no.
 */
export function fileProblem(file: {
  name?: string;
  size: number;
  type: string;
}): string | null {
  if (file.size <= 0) {
    return "That file is empty. Pick the document itself.";
  }
  if (file.size > MAX_FILE_BYTES) {
    return "That file is over 10 MB. Send a smaller copy, or a photograph of it.";
  }
  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    /*
      The three the contract takes, named. "Not a supported type" leaves an
      operator holding a HEIC from an iPhone with nothing to do about it.
    */
    return "Send a PDF, a JPEG or a PNG.";
  }
  return null;
}

/** The three kinds, as the file picker's `accept`. */
export const ACCEPT_ATTRIBUTE = ALLOWED_TYPES.join(",");

/**
 * What to say when sending the file failed, by the code the API gave.
 *
 * Each one is a different next step, which is the whole reason they are
 * separate codes: send it again, start again, file the document again, or wait
 * for a store that does not exist yet.
 */
export function uploadFailure(code: string, message: string): string {
  switch (code) {
    case "document_locked":
      /*
        The document was verified or rejected, here or while the file was on its
        way. The API's sentence says which, and the way forward is filing the
        document again rather than retrying this one.
      */
      return message;
    case "upload_not_arrived":
      return "The file did not reach us. Send it again.";
    case "upload_closed":
      return "That upload is closed. Pick the file again to start a new one.";
    case "document_refused":
      // `details.reason` is `too_large`, `size_mismatch` or `wrong_kind`, and
      // the server's own sentence names which.
      return message;
    default:
      return message || "The file was not sent. Try again.";
  }
}
