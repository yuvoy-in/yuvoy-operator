"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { orderMedia, situationBadge } from "@/lib/account/profile";
import {
  describeKind,
  describeMissingPreview,
  type MediaItem,
} from "@/lib/services/media";
import type { ListingOption } from "@/components/media/attach-form";
import { ReelSheet } from "./reel-sheet";
import { AddReelSheet } from "./add-reel-sheet";

/**
 * Every reel and photograph — yuvoy-operator#58 item 5, and the sheet behind
 * each tile (item 6).
 *
 * Badged by `situation`, which the server computes precisely so three clients
 * cannot disagree: "deriving the situation from two enumerations client side
 * gets it wrong in ways nobody notices for a month."
 *
 * A tile is a BUTTON, not a link. The sheet is the screen: opening it as a
 * route would put the grid's scroll position and the sheet's own state in the
 * history, and closing a reel would mean going back past every one opened
 * before it.
 */
export function ReelsTab({
  media,
  listings,
  suspended,
  emptyLine = "No reels yet",
  offerAdd = true,
}: {
  media: MediaItem[];
  listings: ListingOption[];
  suspended: boolean;
  /**
   * What an empty grid says. The profile's tab says nobody has sent anything
   * yet; one listing's own grid says nothing is on THAT listing, which is a
   * different fact and the one #58 item 4 asks for.
   */
  emptyLine?: string;
  /** Whether empty offers the upload. A listing's own grid does not: the + on
   * the profile is where adding lives, and a second entry point to it here
   * would be a second place for the one-clip-in-flight rule to be reasoned
   * about. */
  offerAdd?: boolean;
}) {
  const [open, setOpen] = useState<MediaItem | null>(null);
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  /*
    The grid catches up when the sheet closes, and only then.

    None of the sheet's writes revalidate: doing so would re-render this tree
    and unmount the sheet holding the receipt, which is the one thing the
    operator is there to read. So the refresh is deferred to the moment the
    sheet goes away, which is also the moment the tile behind it is worth
    redrawing.
  */
  const closeSheet = useCallback(() => {
    setOpen(null);
    setAdding(false);
    router.refresh();
  }, [router]);

  if (media.length === 0) {
    return (
      <div className="mt-6">
        <p className="text-forest/70 text-base">{emptyLine}</p>
        {suspended || !offerAdd ? null : (
          <Button
            variant="secondary"
            block={false}
            className="mt-3"
            onClick={() => setAdding(true)}
          >
            Add a reel
          </Button>
        )}
        {adding ? (
          <AddReelSheet listings={listings} onClose={closeSheet} />
        ) : null}
      </div>
    );
  }

  return (
    <>
      <ul className="mt-6 grid grid-cols-3 gap-2">
        {orderMedia(media).map((item, i) => {
          const badge = situationBadge(item.situation);
          const kind = describeKind(item.kind);
          // What the frame says when there is no picture, and there usually is
          // not: a poster exists only once the provider has produced one.
          const missing = item.posterUrl ? null : describeMissingPreview(item);
          return (
            <li key={item.id ?? i}>
              <button
                type="button"
                /*
                  The KIND as well as the badge, because the badge alone is what
                  a screen reader would otherwise announce: "In review" three
                  times over, with nothing saying which is the photograph. The
                  picture answers that for everybody else.
                */
                aria-label={`${kind?.label ?? "Item"}, ${badge ?? "open"}`}
                onClick={() => setOpen(item)}
                className="ease-interaction block w-full text-left transition-opacity duration-200 hover:opacity-80"
              >
                {item.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.posterUrl}
                    alt=""
                    className="rounded-card aspect-[9/16] w-full object-cover"
                  />
                ) : (
                  <span className="rounded-card border-paper-line bg-paper-deep flex aspect-[9/16] w-full items-center justify-center border border-dashed p-2">
                    <span className="text-forest text-center text-[0.65rem] leading-tight">
                      {missing?.line ?? ""}
                    </span>
                  </span>
                )}
                <span className="label text-forest/75 mt-1 block truncate">
                  {/*
                    The badge, or the kind. A tile with neither is a picture
                    with no name, and the sheet behind it is the only way to
                    find out which of eleven states it is in.
                  */}
                  {badge ?? "Open"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {open ? (
        <ReelSheet
          item={open}
          listings={listings}
          suspended={suspended}
          onClose={closeSheet}
        />
      ) : null}
    </>
  );
}
