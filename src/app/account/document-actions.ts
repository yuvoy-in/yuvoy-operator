"use server";

import { revalidatePath } from "next/cache";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { requireOperator } from "@/lib/auth/session";
import { suspendedMessage } from "@/lib/account/suspended";
import {
  DOCUMENTS_SWITCHED_OFF,
  uploadFailure,
  type AllowedType,
} from "@/lib/account/documents";

/**
 * Sending the file behind a document — yuvoy-operator#46 item 3.
 *
 * Three steps, and the middle one does not happen here: "this signs a URL the
 * browser sends the file straight to, in a private bucket. The file never
 * passes through this API." So this module mints the intent and records the
 * arrival, and the bytes go from the operator's phone to the bucket.
 *
 * ## `uploadUrl` is a credential, and is treated as one
 *
 * "Never stored server-side and never logged: it is a credential for writing
 * one file into a private bucket, and it works for fifteen minutes." It is
 * returned to the caller and held nowhere else — not in a log line, not in an
 * error message, not in the action's state beyond the tick it is used in. The
 * operator's session is deliberately not sent with it either: attaching a
 * bearer token to a third-party origin is how one leaks.
 */

export type IntentResult =
  | {
      ok: true;
      intentId: string;
      uploadUrl: string;
      method: string;
      headers: Record<string, string>;
      maxBytes: number;
    }
  | {
      ok: false;
      message: string;
      locked?: boolean;
      /** No documents store on this service: a state, not a retry. */
      unavailable?: boolean;
    };

export async function startDocumentUpload(
  credentialId: string,
  filename: string,
  contentType: AllowedType,
  sizeBytes: number,
): Promise<IntentResult> {
  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/credentials/{id}/upload-intents",
      {
        params: { path: { id: credentialId } },
        body: { filename, contentType, sizeBytes },
      },
    );
    if (error) throw error;

    return {
      ok: true,
      intentId: data.intentId,
      uploadUrl: data.uploadUrl,
      method: data.method,
      headers: data.headers as Record<string, string>,
      maxBytes: data.maxBytes,
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      return { ok: false, message: "No signal. Nothing was sent. Try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "documents_unavailable") {
        /*
          Two statuses, two different sentences, and the difference decides
          whether an operator tries again in a minute or stops trying.

          `502` is "the document store could not sign an upload just now".
          `503` is "no document store is configured on this service", which is
          what PRODUCTION answers today, so this is the branch a real operator
          meets, and "try again" would have them retrying for weeks. It comes
          back flagged, and the screen draws it as a plain state with no retry
          control rather than as a failure (yuvoy-operator#93).
        */
        return err.status === 503
          ? { ok: false, unavailable: true, message: DOCUMENTS_SWITCHED_OFF }
          : {
              ok: false,
              message: "Could not send the file just now. Try again.",
            };
      }
      if (err.code === "document_locked") {
        // The way forward is filing the document again, not retrying this one.
        return { ok: false, message: err.message, locked: true };
      }
      const refusal = suspendedMessage(err);
      // A suspended business may still send a document (#50), so this should
      // never fire. Kept because the server is the authority on that, not us.
      if (refusal) return { ok: false, message: refusal };
      if (err.isNotFound) {
        return {
          ok: false,
          message:
            "That document is no longer on your account. Reload the page.",
        };
      }
      if (err.status === 400) return { ok: false, message: err.message };
    }
    return { ok: false, message: "The file was not sent. Try again." };
  }
}

export type CompleteResult =
  | { ok: true; filename: string; replacedPrevious: boolean }
  | {
      ok: false;
      message: string;
      retryUpload?: boolean;
      restart?: boolean;
      /** No documents store on this service: a state, not a retry. */
      unavailable?: boolean;
    };

/**
 * Record that the file arrived — and the API decides whether it did.
 *
 * "The browser saying it finished is a reason to look, not a fact. This asks
 * the bucket what arrived: that the file is there, that it carries the metadata
 * only a URL minted here signs into it, that it is the size declared, and that
 * its first bytes are the kind its label claims."
 */
export async function completeDocumentUpload(
  credentialId: string,
  intentId: string,
): Promise<CompleteResult> {
  const { token } = await requireOperator();

  try {
    const { data, error } = await operatorApi(token).POST(
      "/credentials/{id}/upload-intents/{intentId}/complete",
      { params: { path: { id: credentialId, intentId } } },
    );
    if (error) throw error;

    /*
      Revalidated, and the filename kept. Unlike the cancel and closure
      receipts, the re-render here shows MORE than the result does: the row
      picks up the name, and the document's own state and expiry come with it.
      The name is carried back as well so the panel can confirm it without
      waiting for the re-render to land.
    */
    revalidatePath("/account");
    return {
      ok: true,
      filename: data.filename,
      replacedPrevious: data.replacedPrevious,
    };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      /*
        The file may well have arrived: this call is the one that asks. Said as
        "we could not check" rather than "it failed", because the two have
        opposite next steps and completing again is safe — "called again after
        it succeeded, it answers the same thing again."
      */
      return {
        ok: false,
        message: "No signal, so we could not check. Try again in a moment.",
      };
    }
    if (err instanceof OperatorApiError) {
      if (err.code === "documents_unavailable") {
        // The same two statuses as the intent, the same split. See above.
        return err.status === 503
          ? { ok: false, unavailable: true, message: DOCUMENTS_SWITCHED_OFF }
          : {
              ok: false,
              message: "Could not check the file just now. Try again.",
            };
      }
      /*
        Three codes, three different next steps, and the component acts on the
        flags rather than reading the sentence: send the same file again, start
        a whole new upload, or stop because the document was decided while the
        file was in flight.
      */
      if (err.code === "upload_not_arrived") {
        return {
          ok: false,
          message: uploadFailure(err.code, err.message),
          retryUpload: true,
        };
      }
      if (err.code === "upload_closed" || err.code === "document_refused") {
        return {
          ok: false,
          message: uploadFailure(err.code, err.message),
          restart: true,
        };
      }
      if (err.code === "document_locked") {
        return { ok: false, message: err.message };
      }
      if (err.isNotFound) {
        return {
          ok: false,
          message:
            "That document is no longer on your account. Reload the page.",
        };
      }
    }
    return { ok: false, message: "We could not record the file. Try again." };
  }
}
