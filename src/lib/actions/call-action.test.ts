import { describe, expect, it } from "vitest";
import { notFound, redirect } from "next/navigation";
import { UnrecognizedActionError } from "next/dist/client/components/unrecognized-action-error";
import { callAction } from "./call-action";

/** The shape the screens' own client actions answer in. */
type Answer = { ok: true } | { ok: false; message: string };

const UNSENT: Answer = {
  ok: false,
  message: "No signal. Nothing was changed.",
};

/** What `redirect()` and `notFound()` throw, caught so a test can reject with it. */
function thrownBy(fn: () => never): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected it to throw");
}

describe("callAction", () => {
  it("hands back the action's own answer, refusals included", async () => {
    await expect(
      callAction<Answer>(
        async () => ({ ok: true }),
        () => UNSENT,
      ),
    ).resolves.toEqual({ ok: true });
    await expect(
      callAction<Answer>(
        async () => ({ ok: false, message: "Already on." }),
        () => UNSENT,
      ),
    ).resolves.toEqual({ ok: false, message: "Already on." });
  });

  it("turns a request that never came back into the screen's refusal", async () => {
    // What a phone with no signal rejects with, and what a captive portal does.
    for (const dropped of [
      new TypeError("Failed to fetch"),
      new Error("An unexpected response was received from the server."),
      new Error("Connection closed."),
    ]) {
      await expect(
        callAction(
          () => Promise.reject(dropped),
          () => UNSENT,
        ),
      ).resolves.toBe(UNSENT);
    }
  });

  it("gives a redirect back to Next instead of saying there is no signal", async () => {
    const ended = thrownBy(() => redirect("/sign-in"));
    await expect(
      callAction(
        () => Promise.reject(ended),
        () => UNSENT,
      ),
    ).rejects.toBe(ended);

    const gone = thrownBy(() => notFound());
    await expect(
      callAction(
        () => Promise.reject(gone),
        () => UNSENT,
      ),
    ).rejects.toBe(gone);
  });

  it("leaves an action that ran and threw on the error screen", async () => {
    const failed = Object.assign(new Error("An error occurred"), {
      digest: "2130381839",
    });
    await expect(
      callAction(
        () => Promise.reject(failed),
        () => UNSENT,
      ),
    ).rejects.toBe(failed);
  });

  it("leaves an action this deploy does not have to the error screen", async () => {
    const stale = new UnrecognizedActionError("Server Action was not found");
    await expect(
      callAction(
        () => Promise.reject(stale),
        () => UNSENT,
      ),
    ).rejects.toBe(stale);
  });
});
