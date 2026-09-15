"use client";

import { useActionState, useState } from "react";
import { attachMedia, type AttachState } from "./actions";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { describeStatus } from "@/lib/services/listings";

export interface ListingOption {
  id: string;
  title: string;
  status?: string;
}

const initial: AttachState = {};

export function AttachForm({
  mediaAssetId,
  listings,
}: {
  mediaAssetId: string;
  listings: ListingOption[];
}) {
  const [state, action, pending] = useActionState(attachMedia, initial);
  const [chosen, setChosen] = useState<string | null>(null);
  const chosenStatus = chosen
    ? describeStatus(listings.find((l) => l.id === chosen)?.status)
    : null;

  if (state.done) {
    return (
      <p className="text-forest mt-4 text-sm font-bold" role="status">
        Attached. It is now available to that listing.
      </p>
    );
  }

  return (
    <form action={action} className="mt-4 space-y-3">
      <input type="hidden" name="mediaAssetId" value={mediaAssetId} />

      <div>
        <label htmlFor={`listing-${mediaAssetId}`} className="label block">
          Listing
        </label>
        <select
          id={`listing-${mediaAssetId}`}
          name="experienceId"
          required
          className={inputClass("mt-2")}
          defaultValue=""
          onChange={(e) => setChosen(e.target.value || null)}
        >
          <option value="" disabled>
            Choose a listing
          </option>
          {listings.map((listing) => (
            <option key={listing.id} value={listing.id}>
              {/*
                The status in WORDS. It used to print the raw key with its
                underscores stripped — "live changes in review" — which is a
                database value wearing a space, not a sentence.
              */}
              {listing.title}
              {listing.status
                ? ` · ${describeStatus(listing.status).label}`
                : ""}
            </option>
          ))}
        </select>

        {/*
          Attaching to a listing nobody can book — yuvoy-operator#31 §1.

          The issue names this as a real cost of attaching after approval:
          "after a generic approval the clip could then be attached to any
          listing at all, including a draft nobody can book." That half is
          the portal's, and it needs no migration to fix.

          A warning rather than a refusal, deliberately. Adding footage to a
          draft before sending it for review is the NORMAL order — the issue
          says so itself — so refusing it would block the common case to
          prevent an uncommon mistake. What the operator must not do is walk
          away believing travellers can see it.
        */}
        {chosenStatus && !chosenStatus.selling ? (
          <p className="text-terra-deep mt-2 text-sm font-bold">
            That listing is not on sale, so nobody will see this yet.{" "}
            {chosenStatus.label === "Draft"
              ? "Send it to us for review and this goes live with it."
              : "It appears the moment the listing is selling again."}
          </p>
        ) : null}
      </div>

      <fieldset>
        <legend className="label">Where it appears</legend>
        <div className="mt-2 flex gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="radio" name="role" value="hero" defaultChecked />
            First clip
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" name="role" value="gallery" />
            Gallery
          </label>
        </div>
      </fieldset>

      {state.message ? (
        <p className="text-terra-deep text-sm font-bold" role="alert">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} size="md">
        {pending ? "Attaching…" : "Attach to listing"}
      </Button>
    </form>
  );
}
