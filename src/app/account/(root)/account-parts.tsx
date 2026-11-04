/** The account page's number and listings grid, moved out of page.tsx (yuvoy-operator#178). */
import Link from "next/link";
import {
  orderForProfile,
  tileFacts,
  type TileListing,
} from "@/lib/account/profile";
import { posterFor } from "@/lib/services/home";
import { ButtonLink } from "@/components/ui/button";
import { panelClass } from "@/components/ui/panel";
import { Chip } from "@/components/ui/chip";
import { LinkRing } from "@/components/ui/link-pending";

/**
 * One number over its word. The term comes first in the document, as a
 * description list wants it and a screen reader reads it ("Live, 3"), and the
 * number is drawn above it.
 */
export function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="text-forest/70 mt-1 text-xs">{label}</dt>
      <dd className="font-board text-2xl leading-none tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Every listing, in the order they need attention — #58 item 3.
 *
 * Two to a row on a phone, three from 40rem: a third of a phone has no room
 * for the words a draft now says (operator A, approved 3 Oct 2026: "Listings
 * come first, each with its state, and a draft says in words what is still
 * missing"). What each tile says is `tileFacts`.
 *
 * The link is named title first, then the state and the line, in real
 * words: its children would otherwise join with no spaces between them, and
 * a screen reader would read "DraftIsland boat dayStill missing".
 */
export function ListingsGrid({
  listings,
  media,
  canManage,
  suspended,
}: {
  /** `null` when the read failed, which is not the same as having none. */
  listings: (TileListing & { id?: string; title?: string })[] | null;
  media: {
    listing?: { experienceId?: string };
    posterUrl?: string;
    situation?: string;
  }[];
  canManage: boolean;
  suspended: boolean;
}) {
  if (listings === null) {
    return (
      <p className="text-terra-deep mt-6 text-base font-bold">
        Your listings did not load. Try again.
      </p>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="mt-6">
        <p className="text-forest/70 leading-body text-base text-pretty">
          No listings yet
        </p>
        {canManage && !suspended ? (
          <ButtonLink
            href="/account/listings/new"
            variant="secondary"
            block={false}
            className="mt-3"
          >
            Add a listing
          </ButtonLink>
        ) : null}
      </div>
    );
  }

  return (
    <ul className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {orderForProfile(listings).map((listing) => {
        const id = listing.id ?? "";
        const poster = posterFor(media, id);
        const { state, attention, line } = tileFacts(listing);
        const name = [listing.title, state, line].filter(Boolean).join(", ");
        return (
          <li key={id} className="flex">
            <Link
              href={`/account/listings/${id}`}
              aria-label={name}
              className={panelClass(
                "raised",
                "ease-interaction hover:border-forest/40 flex w-full flex-col overflow-hidden p-0 transition-colors duration-200",
              )}
            >
              {poster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={poster}
                  alt=""
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : (
                <span
                  aria-hidden
                  className="bg-paper-line block aspect-[4/3] w-full"
                />
              )}
              <span className="flex flex-col items-start gap-1.5 p-3">
                <Chip tone={attention ? "accent" : "neutral"}>{state}</Chip>
                {/*
                  The listing's own name, in the host's voice (v3.2), and the
                  ring after it while the listing is on its way.
                */}
                <span className="voice-host text-sm leading-snug text-balance">
                  {listing.title}
                  <LinkRing />
                </span>
                {line ? (
                  <span
                    className={
                      attention
                        ? "text-terra-deep text-xs"
                        : "text-forest/70 text-xs"
                    }
                  >
                    {line}
                  </span>
                ) : null}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
