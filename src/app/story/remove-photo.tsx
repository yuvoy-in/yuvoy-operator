"use client";

import { useActionState, useState } from "react";
import { removeStoryPhoto, type RemovePhotoState } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * Take one photograph off the page — two taps, the second one naming what
 * happens.
 *
 * Nothing is lost that cannot be put back, so this is not the typed
 * confirmation a call-off gets. But the tile is small and the phone is wet,
 * and a photograph gone from a live page on a stray tap is a thing somebody
 * notices a week later from a traveller.
 */
export function RemovePhoto({
  photoId,
  position,
}: {
  photoId: string;
  position: number;
}) {
  const [armed, setArmed] = useState(false);
  const [state, act, pending] = useActionState<RemovePhotoState, FormData>(
    removeStoryPhoto,
    {},
  );

  if (!armed) {
    return (
      <Button onClick={() => setArmed(true)} variant="secondary">
        Remove
        {/* Five buttons say "Remove"; a screen reader needs to hear which. */}
        <span className="sr-only"> photograph {position}</span>
      </Button>
    );
  }

  return (
    <form action={act} className="space-y-2">
      <input type="hidden" name="photoId" value={photoId} />
      <p className="text-sm font-bold">Take it off your page?</p>
      <Button type="submit" variant="danger" disabled={pending}>
        {pending ? "Removing…" : "Remove it"}
      </Button>
      <Button
        onClick={() => setArmed(false)}
        variant="secondary"
        disabled={pending}
      >
        Keep it
      </Button>
      {state.message ? (
        <p role="alert" className="text-terra-deep text-xs font-bold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
