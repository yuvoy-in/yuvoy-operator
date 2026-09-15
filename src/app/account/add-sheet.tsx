"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { PlusIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";
import { AddReelSheet } from "./add-reel-sheet";
import type { ListingOption } from "@/components/media/attach-form";

/**
 * The + on the business profile — yuvoy-operator#58 item 8.
 *
 * Two choices: a listing, or a reel. Both used to be reachable only from a tab
 * that has since gone (#56), which is why + exists at all.
 *
 * ## STAFF get one of the two
 *
 * "STAFF see only Add a reel." The media uploads carry no role in the contract
 * and creating a listing is OWNER, ADMIN or MANAGER — so a staff phone on a
 * boat can send footage back and cannot invent something to sell.
 */
export function AddSheet({
  canManage,
  listings,
}: {
  canManage: boolean;
  /** Every listing, for the reel flow's required listing choice. */
  listings: ListingOption[];
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  return (
    <>
      <button
        type="button"
        aria-label="Add"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={panelClass(
          "raised",
          "ease-interaction hover:bg-paper flex size-11 items-center justify-center p-0 transition-colors duration-200",
        )}
      >
        <PlusIcon className="text-forest size-5" />
      </button>

      {open ? (
        <Panel
          role="dialog"
          aria-label="Add"
          className="absolute right-5 z-20 mt-14 w-64 p-3"
        >
          {canManage ? (
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                router.push("/account/listings/new");
              }}
            >
              Add a listing
            </Button>
          ) : null}
          <div className={canManage ? "mt-2" : undefined}>
            {/*
              The upload itself is the shipped `Uploader`, opened here rather
              than on a page of its own: two upload screens would be two places
              for the one-clip-in-flight rule to drift, and that rule is what
              stops a jetty phone starting three uploads.
            */}
            <Button
              variant="secondary"
              onClick={() => {
                setOpen(false);
                setAdding(true);
              }}
            >
              Add a reel
            </Button>
          </div>
          {listings.length === 0 ? (
            <p className="text-forest/70 mt-2 text-xs">
              A reel goes on a listing, so make one first.
            </p>
          ) : null}
        </Panel>
      ) : null}

      {adding ? (
        <AddReelSheet
          listings={listings}
          onClose={() => {
            setAdding(false);
            // The Reels tab is on the same screen, and a finished upload is a
            // new tile on it. Nothing revalidates: see `ReelsTab`.
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}
