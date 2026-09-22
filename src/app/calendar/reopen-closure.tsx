"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { reopenClosure, type ReopenState } from "./actions";
import { Button } from "@/components/ui/button";

/** Said when the API had no sentence: it was already reopened, or is gone. */
export const STALE_REOPEN = "Reopened. What you were reading was out of date.";

/**
 * Put one closure back — yuvoy-operator#45 item 2.
 *
 * ## Why the note is rendered rather than summarised
 *
 * Reopening does not promise that anything is on sale again. "A departure it
 * holds goes back to open only if it is still closed, has not left yet, and no
 * other closure still in force holds it. **A called-off departure is never
 * reopened.**" So "reopened" alone can be true of a day where nothing changed,
 * and the API's own sentence is the only thing that gives both counts in words.
 *
 * ## The note outlives this row, and the day re-reads at once
 *
 * A reopened closure drops out of the day's list, so the row holding its
 * counts unmounts on the next read of the calendar. It used to wait for the
 * operator to tap "Show the day", and until then the day went on saying Closed
 * (op#89 f16). Now the note is handed UP to the day's panel (`onReopened`),
 * which keeps it across the refresh the way the request queue keeps an
 * accept's receipt, and the calendar re-reads straight away.
 */
export function ReopenClosure({
  id,
  onReopened,
}: {
  id: string;
  /** Hands the note to the day's panel, where a refresh cannot reach it. */
  onReopened: (id: string, note: string) => void;
}) {
  const [state, act, pending] = useActionState<ReopenState, FormData>(
    reopenClosure,
    {},
  );
  const router = useRouter();

  useEffect(() => {
    if (!state.done) return;
    /*
      The note when there is one. `already_reopened` and `404` both land here
      with none: they mean the same thing to somebody looking at this screen,
      which is that what they were reading is out of date.
    */
    onReopened(id, state.note ?? STALE_REOPEN);
    router.refresh();
    // `done` flips once; `id` and the callbacks are stable for this row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.done]);

  /*
    Nothing here once it is done: the note is on the day's panel, and saying
    it in this row too, for the moment before the day re-reads and the row
    goes, would say it twice.
  */
  if (state.done) return null;

  return (
    <form action={act} className="mt-2">
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="secondary"
        block={false}
        disabled={pending}
      >
        {pending ? "Reopening…" : "Reopen"}
      </Button>
      {state.message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
