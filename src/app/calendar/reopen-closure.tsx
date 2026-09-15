"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { reopenClosure, type ReopenState } from "./actions";
import { Button } from "@/components/ui/button";

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
 * So the action does NOT revalidate: the day dropping this closure would unmount
 * the row holding the counts. The day is re-read on the operator's own tap, and
 * what is on sale comes from that re-read rather than from an assumption here.
 */
export function ReopenClosure({ id }: { id: string }) {
  const [state, act, pending] = useActionState<ReopenState, FormData>(
    reopenClosure,
    {},
  );
  const router = useRouter();

  return (
    <form action={act} className="mt-2">
      <input type="hidden" name="id" value={id} />
      {state.done ? (
        <div role="status">
          <p className="text-forest/80 text-sm">
            {/*
              The note when there is one. `already_reopened` and `404` both land
              here with none: they mean the same thing to somebody looking at
              this screen, which is that what they were reading is out of date.
            */}
            {state.note ?? "Reopened. What you were reading was out of date."}
          </p>
          <Button
            variant="secondary"
            block={false}
            className="mt-2"
            onClick={() => router.refresh()}
          >
            Show the day
          </Button>
        </div>
      ) : (
        <Button
          type="submit"
          variant="secondary"
          block={false}
          disabled={pending}
        >
          {pending ? "Reopening…" : "Reopen"}
        </Button>
      )}
      {state.message ? (
        <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
