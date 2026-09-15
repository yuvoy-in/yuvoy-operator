"use client";

import { Sheet } from "@/components/ui/sheet";
import { Uploader } from "@/components/media/uploader";
import { PhotoUploader } from "@/components/media/photo-uploader";
import type { ListingOption } from "@/components/media/attach-form";

/**
 * Add a reel, from the business profile — yuvoy-operator#58 item 8.
 *
 * ## The uploaders are the shipped ones, not copies
 *
 * One clip in flight at a time, the tus resume across a reload, the local
 * preflight, the slot bound to the bytes it holds: all of that lives in
 * `Uploader`, and a second upload screen would be a second place for it to
 * drift. What is new here is only where it is reached from.
 *
 * ## Why the listing choice is inside each uploader
 *
 * The item asks for "a required listing select, then the existing `Uploader`
 * and `PhotoUploader`". Both already carry that select — `ListingPicker`, which
 * exists because naming the listing BEFORE the file is what makes the
 * moderator's `NOT_THIS_EXPERIENCE` rejection mean something. A select above
 * them would be a third copy of the same question, and the two below it would
 * still be the ones the request is built from.
 *
 * `fixedExperienceId` is the Replace path (#58 item 6): the listing is decided
 * by the reel being replaced, so neither picker is drawn.
 */
export function AddReelSheet({
  listings,
  fixedExperienceId,
  note,
  onClose,
}: {
  listings: ListingOption[];
  fixedExperienceId?: string;
  /** The line a Replace earns while the old one is still up. */
  note?: string | null;
  onClose: () => void;
}) {
  return (
    <Sheet title="Add a reel" onClose={onClose}>
      {note ? <p className="mb-5 text-sm font-bold">{note}</p> : null}

      {listings.length === 0 ? (
        <p className="text-forest/80 text-sm">
          A reel goes on a listing, so there is nowhere to put one yet. Add a
          listing first.
        </p>
      ) : (
        <div className="space-y-8">
          <section>
            <h3 className="font-display text-xl">A clip</h3>
            <p className="text-forest/70 mt-2 text-sm">
              Upright, up to 60 seconds. Choose the listing first, then the
              file. Losing signal pauses the upload instead of starting it
              again.
            </p>
            <div className="mt-4">
              <Uploader
                listings={listings}
                fixedExperienceId={fixedExperienceId}
              />
            </div>
          </section>

          <section>
            <h3 className="font-display text-xl">A photograph</h3>
            <p className="text-forest/70 mt-2 text-sm">
              For a listing that has no footage yet, or to show what a clip
              cannot. Reviewed by a person, exactly like a reel.
            </p>
            <div className="mt-4">
              <PhotoUploader
                listings={listings}
                fixedExperienceId={fixedExperienceId}
              />
            </div>
          </section>
        </div>
      )}
    </Sheet>
  );
}
