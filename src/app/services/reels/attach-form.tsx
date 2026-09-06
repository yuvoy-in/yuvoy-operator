"use client";

import { useActionState } from "react";
import { attachMedia, type AttachState } from "./actions";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";

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
        >
          <option value="" disabled>
            Choose a listing
          </option>
          {listings.map((listing) => (
            <option key={listing.id} value={listing.id}>
              {listing.title}
              {listing.status
                ? ` · ${listing.status.replaceAll("_", " ")}`
                : ""}
            </option>
          ))}
        </select>
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
