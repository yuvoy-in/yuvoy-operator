"use server";

import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { getBookingThread } from "@/lib/messages/fetch";
import type { BookingThread, ThreadMessage } from "@/lib/messages/thread";

/**
 * Writing in a booking's conversation — yuvoy-operator#52 items 2 and 3.
 *
 * ## Why these are Server Actions and not a fetch from the browser
 *
 * `/operator/v1` refuses CORS by design and the session is an httpOnly cookie
 * the browser cannot read, so there is nothing for client-side code to call
 * with. This repo has no route handlers either, enforced by a `qa` guard.
 *
 * ## No `revalidatePath` on any of them
 *
 * The rule this repo settled on is to revalidate only when the re-render shows
 * more than the returned value would. A conversation is the opposite case: the
 * message is appended to a list the client is already holding, and re-rendering
 * the whole booking screen would throw away the scroll position, the half-typed
 * reply, and the earlier pages somebody just loaded.
 */

/** What the composer gets back. `ok` decides whether the text is cleared. */
export type SendResult =
  | { ok: true; message: ThreadMessage }
  /**
   * `reload` means the conversation itself changed under them — it was
   * cancelled, declined, or the window closed while the box was open — so the
   * screen replaces the thread rather than only printing a sentence. Without it
   * the composer would still be sitting there, ready to be refused again.
   */
  | { ok: false; message: string; reload?: boolean };

export async function sendMessage(
  bookingId: string,
  text: string,
): Promise<SendResult> {
  const { token } = await requireOperator();

  /*
    Trimmed here as well as on the server, because an empty box is not worth a
    round trip. Nothing else is checked: the portal does NO filtering of phone
    numbers, emails or links (#52 `Do not build`) — the API decides, and its
    refusal names what it found without repeating any of the text.
  */
  const body = text.trim();
  if (body.length === 0) {
    return { ok: false, message: "Write something first." };
  }

  try {
    const { data, error } = await operatorApi(token).POST(
      "/bookings/{id}/messages",
      { params: { path: { id: bookingId } }, body: { text: body } },
    );
    if (error) throw error;
    return { ok: true, message: data as ThreadMessage };
  } catch (err) {
    if (err instanceof OperatorNetworkError) {
      /*
        "Nothing was sent" is the load-bearing half. An operator who believes a
        message went out stops watching for the question again, and the
        traveller is standing on a jetty waiting for an answer.
      */
      return { ok: false, message: "No signal. Nothing was sent. Try again." };
    }
    if (err instanceof OperatorApiError) {
      if (err.status === 429) {
        return {
          ok: false,
          message: "Too many messages. Wait a minute and send it again.",
        };
      }
      if (err.code === "messages_closed") {
        /*
          The conversation closed while the box was open. The API's sentence
          names which of the three it was, and the thread is reloaded so the
          composer goes with it.
        */
        return {
          ok: false,
          message:
            err.message ||
            "No more messages can be sent on this booking. The conversation can still be read.",
          reload: true,
        };
      }
      if (err.status === 400) {
        /*
          Rendered verbatim. `details.text` is `contact details`, `required`,
          `too long` or `unprintable`, and the server's own sentence says which
          and why — "the rule is the traveller's too", so an operator who is told
          it once should be told it in the words the traveller would recognise.

          The typed text is NOT cleared by the caller on a failure, so a message
          refused for a phone number can have the number taken out and sent.
        */
        return {
          ok: false,
          message: err.message || "That message was not accepted.",
        };
      }
      if (err.isNotFound) {
        return {
          ok: false,
          message: "This booking is not on your account any more.",
        };
      }
    }
    return { ok: false, message: "That did not send. Try again." };
  }
}

/**
 * Mark the conversation read up to a message somebody was actually shown.
 *
 * Soft-failing on purpose, and it returns nothing. Marking read is housekeeping
 * the operator did not ask for; a failure means a count stays high for a while,
 * and putting an error on screen for it would interrupt somebody reading a
 * message to tell them about a marker they never knew existed.
 */
export async function markThreadRead(
  bookingId: string,
  upTo: string,
): Promise<void> {
  const { token } = await requireOperator();
  try {
    const { error } = await operatorApi(token).POST(
      "/bookings/{id}/messages/read",
      { params: { path: { id: bookingId } }, body: { upTo } },
    );
    if (error) throw error;
  } catch {
    // Deliberately silent. See above.
  }
}

/** One page of older messages, for "Show earlier messages". */
export async function loadEarlier(
  bookingId: string,
  cursor: string,
): Promise<
  | {
      ok: true;
      messages: ThreadMessage[];
      nextCursor?: string;
      complete: boolean;
    }
  | { ok: false; message: string }
> {
  const { token } = await requireOperator();
  try {
    const page = await getBookingThread(token, bookingId, cursor);
    return {
      ok: true,
      messages: page.messages,
      nextCursor: page.nextCursor,
      complete: page.complete,
    };
  } catch {
    /*
      Said rather than silent, unlike the read marker: somebody pressed a button
      and nothing appeared, and the honest answer is that the older messages did
      not load rather than that there are none.
    */
    return { ok: false, message: "Those did not load. Try again." };
  }
}

/** The first page again, after the conversation changed underneath. */
export async function reloadThread(
  bookingId: string,
): Promise<BookingThread | null> {
  const { token } = await requireOperator();
  try {
    return await getBookingThread(token, bookingId);
  } catch {
    return null;
  }
}
