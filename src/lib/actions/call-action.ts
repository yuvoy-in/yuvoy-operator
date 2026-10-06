import {
  unstable_isUnrecognizedActionError,
  unstable_rethrow,
} from "next/navigation";

/**
 * A Server Action called from the browser, and the one failure it cannot
 * answer for itself: the request that never came back.
 *
 * Every action here turns its OWN failures into a sentence for the screen
 * ("No signal. Nothing was saved. Try again." when the API cannot be reached),
 * and none of that can run when it is the phone that has lost the signal. The
 * call then rejects (a fetch that failed, or an answer that is not the
 * action's), and a rejection nobody catches goes to the nearest error
 * boundary. Found by the stability audit before release: one tap that did not
 * arrive swapped the whole screen for "That did not load", a half-filled
 * booking list included, and a button that had set itself busy before the
 * await stayed busy for good.
 *
 * So the rejection becomes `unsent()`: the screen's usual refusal, in the
 * words that screen already uses for no signal.
 *
 * Three rejections are NOT a dropped request, and each is handed back exactly
 * as it came:
 *
 *   - **Next's own control flow.** An action that redirects (a session that
 *     ended, a builder step that moves on) or calls `notFound()` rejects the
 *     call as well. `unstable_rethrow` gives that back to Next before anything
 *     else looks at it; swallowing it is how a dead session would be told "No
 *     signal".
 *   - **An action this deploy does not have.** A page left open across a
 *     release asks for an action id the server no longer knows. Trying again
 *     cannot help, and "No signal" would send somebody to stand at the end of
 *     the jetty for nothing.
 *   - **An action that ran and threw.** The server answered: with an error,
 *     which reaches the browser carrying a `digest`. That is a failure of
 *     ours, not of the signal, and it keeps the error screen it had.
 */
export async function callAction<T>(
  send: () => Promise<T>,
  unsent: () => T,
): Promise<T> {
  try {
    return await send();
  } catch (error) {
    unstable_rethrow(error);
    if (unstable_isUnrecognizedActionError(error) || answeredWithError(error)) {
      throw error;
    }
    return unsent();
  }
}

/** The server's own error, as Flight delivers it: always with a digest. */
function answeredWithError(error: unknown): boolean {
  return (
    error instanceof Error &&
    typeof (error as { digest?: unknown }).digest === "string"
  );
}
