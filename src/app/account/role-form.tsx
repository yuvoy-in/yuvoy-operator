"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { setMediaRole, type RoleState } from "@/components/media/actions";
import { Button } from "@/components/ui/button";

const initial: RoleState = {};

/**
 * Cover or gallery, on the listing this reel is already on — #58 item 6.
 *
 * Two buttons and no current state, because `OperatorMedia` does not carry the
 * role yet (the item says so, and lists it under what the API still owes us).
 * Drawing "Make it the cover" as selected would be a guess, and the guess is
 * wrong for every gallery item on a listing that has a cover.
 *
 * The receipt is the whole point of the action, so this does not revalidate:
 * the sheet stays open saying "Saved", and the refresh happens on the
 * operator's tap.
 */
export function RoleForm({
  mediaAssetId,
  experienceId,
}: {
  mediaAssetId: string;
  experienceId: string;
}) {
  const [state, act, pending] = useActionState(setMediaRole, initial);
  const router = useRouter();

  if (state.done) {
    return (
      <div className="mt-4">
        <p role="status" className="text-sm font-bold">
          Saved.
        </p>
        <Button
          variant="secondary"
          size="md"
          className="mt-3"
          onClick={() => router.refresh()}
        >
          Show it
        </Button>
      </div>
    );
  }

  return (
    <form action={act} className="mt-4">
      <input type="hidden" name="mediaAssetId" value={mediaAssetId} />
      <input type="hidden" name="experienceId" value={experienceId} />
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          name="role"
          value="hero"
          variant="secondary"
          size="md"
          block={false}
          disabled={pending}
        >
          Make it the cover
        </Button>
        <Button
          type="submit"
          name="role"
          value="gallery"
          variant="secondary"
          size="md"
          block={false}
          disabled={pending}
        >
          Move to gallery
        </Button>
      </div>
      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
