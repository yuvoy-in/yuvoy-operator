"use client";

import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { Uploader } from "@/components/media/uploader";
import { PhotoUploader } from "@/components/media/photo-uploader";
import { ReelsTab } from "@/app/account/reels-tab";
import type { ListingOption } from "@/components/media/attach-form";
import type { MediaItem } from "@/lib/services/media";

/**
 * Step 6 — what the listing looks like.
 *
 * The shipped uploaders with `experienceId` fixed to this draft and no listing
 * picker: the draft IS the listing, and offering a choice would let somebody
 * put a clip on a different one from inside this listing's own builder.
 *
 * Never required. A listing can be sent for review with nothing on it, and the
 * cost of that is said rather than enforced: a listing with no picture renders
 * as a blank card in the traveller app, which is exactly what yuvoy.in showed
 * for months.
 */
export function MediaStep({
  id,
  title,
  media,
  back,
  next,
}: {
  id: string;
  title: string;
  media: MediaItem[];
  back: string;
  next: string;
}) {
  // One entry, this listing, so neither uploader draws a picker.
  const listings: ListingOption[] = [{ id, title, status: "draft" }];

  return (
    <Panel className="mt-6">
      {/* One title: the stepper names the step (#80 t2, #85 s11). */}
      <h2 className="sr-only">Media</h2>
      <p className="text-forest/70 text-sm">
        Not required, but a listing with no reel or photograph shows travellers
        a blank card.
      </p>

      <div className="mt-5">
        <ReelsTab
          media={media}
          listings={listings}
          suspended={false}
          emptyLine="Nothing on it yet"
          offerAdd={false}
        />
      </div>

      <section className="mt-8">
        <h3 className="font-display text-xl">Add a clip</h3>
        <div className="mt-4">
          <Uploader listings={listings} fixedExperienceId={id} />
        </div>
      </section>

      <section className="mt-8">
        <h3 className="font-display text-xl">Add a photograph</h3>
        <div className="mt-4">
          <PhotoUploader listings={listings} fixedExperienceId={id} />
        </div>
      </section>

      <div className="border-paper-line mt-6 flex items-center gap-4 border-t pt-4">
        <Link
          href={next}
          className="text-forest tap-target text-sm font-bold underline underline-offset-4"
        >
          Next
        </Link>
        <Link
          href={back}
          className="text-forest/75 tap-target text-sm underline underline-offset-4"
        >
          Back
        </Link>
      </div>
    </Panel>
  );
}
