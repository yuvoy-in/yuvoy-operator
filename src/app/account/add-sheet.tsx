"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonClass } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { PlusIcon } from "@/components/ui/icons";
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
 *
 * With one choice there is nothing to choose, so a staff login's + opens the
 * reel sheet itself. A menu of one item is a tap that decides nothing, and it
 * put two controls named "Add a reel" side by side.
 *
 * ## It says what it adds (yuvoy-operator#109)
 *
 * It shipped as a bare + whose whole accessible name was "Add": a screen
 * reader heard as little as a sighted operator saw, on the button that starts
 * the most important thing an operator does. It now reads "Add" beside the +,
 * and its name is what is behind it: "Add a listing or a reel", or "Add a
 * reel" for STAFF. The name starts with the word on screen, so saying "tap
 * Add" to a voice control still reaches it (WCAG 2.5.3, label in name). The
 * word is short on purpose: it shares a phone's width with the business name.
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

  const name = canManage ? "Add a listing or a reel" : "Add a reel";

  return (
    <>
      <button
        type="button"
        aria-label={name}
        aria-haspopup="dialog"
        aria-expanded={canManage ? open : undefined}
        onClick={() => (canManage ? setOpen((was) => !was) : setAdding(true))}
        className={buttonClass({
          variant: "secondary",
          size: "md",
          block: false,
          className: "gap-1.5 px-4",
        })}
      >
        <PlusIcon />
        Add
      </button>

      {open ? (
        <Panel
          role="dialog"
          aria-label={name}
          className="absolute right-5 z-20 mt-14 w-64 p-3"
        >
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(false);
              router.push("/account/listings/new");
            }}
          >
            Add a listing
          </Button>
          <div className="mt-2">
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
