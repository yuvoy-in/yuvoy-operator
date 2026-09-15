"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { setMediaRole, type RoleState } from "@/components/media/actions";
import { Button } from "@/components/ui/button";

const initial: RoleState = {};

/**
 * Cover or gallery, on the listing this reel is already on — #58 item 6,
 * finished in #67 now that the API says which one it is.
 *
 * ## It shows the state, and offers only the move
 *
 * `OperatorMedia.role` has been sent since 2026-09-14. Before it existed this
 * drew both buttons, because a sheet that guessed would be wrong for every
 * gallery item on a listing that has a cover. With the field, offering "Make it
 * the cover" on something that already IS the cover is offering a no-op: the
 * API takes it and changes nothing.
 *
 * `null` keeps both buttons. Absent means unknown, never a guess.
 *
 * ## Demoting leaves the listing with no cover
 *
 * Said before the tap. "Sending `POST /media/{id}/publish` with `role: gallery`
 * for a published hero takes the cover away, so this reads `gallery` afterwards
 * and the listing has no cover until another item is published as `hero`." An
 * operator tidying their gallery should not discover that from the traveller
 * app.
 *
 * The receipt is the point of the action, so this does not revalidate: the
 * sheet stays open saying "Saved", and the refresh happens on the tap.
 */
export function RoleForm({
  mediaAssetId,
  experienceId,
  role,
}: {
  mediaAssetId: string;
  experienceId: string;
  /** `null` or absent when the API did not say. */
  role: "hero" | "gallery" | null | undefined;
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

  const isCover = role === "hero";
  const isGallery = role === "gallery";

  return (
    <form action={act} className="mt-4">
      <input type="hidden" name="mediaAssetId" value={mediaAssetId} />
      <input type="hidden" name="experienceId" value={experienceId} />

      {isCover ? (
        <p className="text-sm font-bold">This is the listing&rsquo;s cover.</p>
      ) : isGallery ? (
        <p className="text-forest/80 text-sm">This is in the gallery.</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {!isCover ? (
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
        ) : null}
        {!isGallery ? (
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
        ) : null}
      </div>

      {/*
        The cost of demoting, before the tap rather than after. Only on the
        cover: moving a gallery item to the gallery is the no-op that is not
        drawn at all.
      */}
      {isCover ? (
        <p className="text-forest/70 mt-2 text-sm">
          Moving it to the gallery leaves this listing with no cover until you
          make another one the cover.
        </p>
      ) : null}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
