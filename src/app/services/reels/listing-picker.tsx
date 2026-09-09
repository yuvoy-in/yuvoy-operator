"use client";

import { inputClass } from "@/components/ui/input";
import { describeStatus } from "@/lib/services/listings";
import type { ListingOption } from "./attach-form";

/**
 * Which listing this upload is for, chosen BEFORE the file — D-031 C5.
 *
 * ## Why the order matters
 *
 * A clip used to be uploaded, attested, moderated and only then attached. One
 * of the moderator's rejection reasons is `NOT_THIS_EXPERIENCE`, and nobody
 * could ever act on it, because nothing recorded which listing the clip was
 * for. After a generic approval it could then be attached to any listing at
 * all. Naming the listing at the start is what makes that rejection reason
 * mean something, and it removes the separate attach step from the ordinary
 * flow: approval attaches it (yuvoy-operator#31 §1, #35).
 *
 * ## Required for a photograph, optional for a clip
 *
 * That asymmetry is the API's and is deliberate: `POST /media/photo-intents`
 * requires `experienceId` because nothing called that endpoint, so there was
 * no deployed client to break. `POST /media/upload-intents` accepts it and
 * will require it later, because the shipped uploader sent no listing and
 * making it mandatory would have stopped every reel upload in production the
 * moment the API deployed.
 *
 * This portal sends it on both, which is what lets that field become required.
 *
 * ## A draft listing is a valid answer
 *
 * The normal order is an operator writing a listing and then adding footage
 * to it, so refusing a draft would block the common case to prevent an
 * uncommon mistake. What they must not do is walk away believing travellers
 * can already see it — hence the note, which is a warning and not a refusal.
 */
export function ListingPicker({
  id,
  listings,
  value,
  onChange,
  role,
  onRoleChange,
  disabled,
  noun,
}: {
  id: string;
  /** `null` means the listings could not be read. See `listListings`. */
  listings: ListingOption[] | null;
  value: string;
  onChange: (experienceId: string) => void;
  role: "hero" | "gallery";
  onRoleChange: (role: "hero" | "gallery") => void;
  disabled?: boolean;
  /** "photograph" or "clip" — this component words itself for both. */
  noun: string;
}) {
  if (listings === null) {
    return (
      <p className="text-terra-deep text-sm font-bold">
        We could not load your listings. Try again in a moment — this is us, not
        you.
      </p>
    );
  }

  if (listings.length === 0) {
    return (
      <p className="text-forest/80 text-sm">
        Write a listing first, then come back and add a {noun} to it. A {noun}
        {" belongs to a listing, so there is nowhere to put this one yet."}
      </p>
    );
  }

  const chosen = listings.find((l) => l.id === value);
  const status = chosen ? describeStatus(chosen.status) : null;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${id}-listing`} className="label block">
          Which listing
        </label>
        <select
          id={`${id}-listing`}
          className={inputClass("mt-2")}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="" disabled>
            Choose a listing
          </option>
          {listings.map((listing) => (
            <option key={listing.id} value={listing.id}>
              {/* The status in WORDS. Printing the raw key gives
                  "live changes in review", which is a database value wearing
                  a space rather than a sentence. */}
              {listing.title}
              {listing.status
                ? ` · ${describeStatus(listing.status).label}`
                : ""}
            </option>
          ))}
        </select>

        {status && !status.selling ? (
          <p className="text-terra-deep mt-2 text-sm font-bold">
            That listing is not on sale, so nobody will see this yet.{" "}
            {status.label === "Draft"
              ? "Send it to us for review and this goes live with it."
              : "It appears the moment the listing is selling again."}
          </p>
        ) : null}
      </div>

      <fieldset disabled={disabled}>
        <legend className="label">Where it appears</legend>
        <div className="mt-2 flex gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-role`}
              value="hero"
              checked={role === "hero"}
              onChange={() => onRoleChange("hero")}
            />
            First
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name={`${id}-role`}
              value="gallery"
              checked={role === "gallery"}
              onChange={() => onRoleChange("gallery")}
            />
            Gallery
          </label>
        </div>
        {/*
          A listing shows ONE hero, and migration 0058 made the database say
          so — a second attach answers `hero_taken` rather than letting a
          tie-break nobody set decide which picture headlines the listing.
          Gallery is the default here for that reason: the shipped attach form
          defaulted to hero, which made `hero_taken` the answer the second
          upload on any listing got.
        */}
        {role === "hero" ? (
          <p className="text-forest/70 mt-2 text-xs">
            A listing shows one first {noun}. If it already has one, choose
            Gallery — or move the existing one first.
          </p>
        ) : null}
      </fieldset>
    </div>
  );
}
