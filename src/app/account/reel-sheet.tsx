"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { situationBadge } from "@/lib/account/profile";
import { describeKind, describeMissingPreview } from "@/lib/services/media";
import {
  declineLine,
  replaceNote,
  sheetActions,
} from "@/lib/services/reel-sheet";
import { RightsForm } from "@/components/media/rights-form";
import { AttachForm, type ListingOption } from "@/components/media/attach-form";
import { WithdrawForm } from "@/components/media/withdraw-form";
import { RoleForm } from "./role-form";
import { AddReelSheet } from "./add-reel-sheet";
import type { MediaItem } from "@/lib/services/media";

/**
 * One reel, and everything that can be done to it — yuvoy-operator#58 item 6.
 *
 * ## There is no player
 *
 * `GET /media` carries no playback URL, so this shows the poster and says what
 * the thing is. The item is explicit that a player is not to be built.
 *
 * ## Which actions appear
 *
 * `sheetActions` decides, from `situation` alone. Every control here maps to an
 * endpoint the API will accept in that state, so nothing on this sheet can
 * answer with a refusal the operator could have been spared.
 *
 * ## A suspended business gets none of them
 *
 * `403 account_suspended` on every write (#50). The sheet still opens: reading
 * what is on a listing is exactly what a suspended operator needs while they
 * sort it out.
 */
export function ReelSheet({
  item,
  listings,
  suspended,
  onClose,
}: {
  item: MediaItem;
  listings: ListingOption[];
  suspended: boolean;
  onClose: () => void;
}) {
  const [replacing, setReplacing] = useState(false);
  const id = item.id ?? "";
  const kind = describeKind(item.kind);
  const badge = situationBadge(item.situation);
  const can = sheetActions(item);
  const attachedTo = item.listing?.experienceId ?? "";
  const missing = item.posterUrl ? null : describeMissingPreview(item);

  /*
    Replace is not an endpoint. It is the Add a reel sheet with the listing
    already decided — the new one goes through review on its own, and the old
    one is taken down separately once it is live.
  */
  if (replacing) {
    return (
      <AddReelSheet
        listings={listings}
        fixedExperienceId={attachedTo || undefined}
        note={replaceNote(item.situation)}
        onClose={onClose}
      />
    );
  }

  return (
    <Sheet title={kind ? kind.label : "This one"} onClose={onClose}>
      {item.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.posterUrl}
          alt=""
          className="rounded-card mx-auto max-h-64 w-auto object-contain"
        />
      ) : (
        <div className="rounded-card border-cream-line bg-forest/5 flex min-h-32 items-center justify-center border border-dashed p-6">
          {/*
            Why there is no picture, not a grey rectangle somebody has to
            interpret. Most clips have none: a poster is only stored once the
            provider has produced one.
          */}
          <p className="text-forest text-center text-xs">
            {missing?.line ?? "No preview."}
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {badge ? <Chip>{badge}</Chip> : null}
        {kind ? <Chip>{kind.label}</Chip> : null}
      </div>

      {item.listing?.title ? (
        <p className="text-forest/70 mt-3 text-sm">On {item.listing.title}</p>
      ) : null}

      {/* Why it was declined, in the reviewer's own words. */}
      {can.whyDeclined ? (
        <div className="border-terra-deep/30 mt-4 border-t pt-3">
          <p className="text-terra-deep text-sm font-bold">
            {declineLine(item.rejection?.code) ?? "This one was not accepted."}
          </p>
          {item.rejection?.note ? (
            <p className="text-forest/70 mt-1 text-sm">{item.rejection.note}</p>
          ) : null}
        </div>
      ) : null}

      {suspended ? (
        <p className="text-forest/70 mt-5 text-sm">
          Nothing can be changed while the account is on hold.
        </p>
      ) : (
        <div className="mt-5 space-y-5">
          {can.confirmRights && id ? <RightsForm mediaAssetId={id} /> : null}

          {can.coverOrGallery && id ? (
            <div>
              <p className="label text-forest/75">Where it appears</p>
              <RoleForm
                mediaAssetId={id}
                experienceId={attachedTo}
                /*
                  `listing.role`, not a top-level one. The role belongs to the
                  PAIRING between this media and that listing, which is why it
                  sits beside `experienceId` — the same asset can be a cover on
                  one listing and a gallery item on another.
                */
                role={item.listing?.role}
              />
            </div>
          ) : null}

          {can.putOnAnother && id ? (
            <div>
              <p className="label text-forest/75">Put it on another listing</p>
              {/*
                Every listing EXCEPT the one it is on. Offering that one back
                is the cover/gallery control above, and two ways to do the same
                thing on one sheet is how an operator ends up unsure which they
                just did.
              */}
              <AttachForm
                mediaAssetId={id}
                listings={listings.filter((l) => l.id !== attachedTo)}
              />
            </div>
          ) : null}

          {can.replace ? (
            <div>
              <Button
                variant="secondary"
                size="md"
                block={false}
                onClick={() => setReplacing(true)}
              >
                Replace it
              </Button>
              {replaceNote(item.situation) ? (
                <p className="text-forest/70 mt-2 text-sm">
                  {replaceNote(item.situation)}
                </p>
              ) : null}
            </div>
          ) : null}

          {can.takeDown && id ? (
            <WithdrawForm mediaAssetId={id} attachedTo={item.listing?.title} />
          ) : null}
        </div>
      )}
    </Sheet>
  );
}
