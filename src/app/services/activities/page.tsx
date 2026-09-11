import type { Metadata } from "next";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import {
  listingsWithoutFootage,
  orderListings,
  type OperatorExperience,
} from "@/lib/services/listings";
import { Screen } from "@/components/chrome/screen";
import { Empty } from "@/components/ui/states";
import { Panel } from "@/components/ui/panel";
import {
  categoryChoices,
  destinationChoices,
  marketName,
  type Vocabulary,
} from "@/lib/services/vocabulary";
import { SectionSwitch } from "../section-switch";
import { ListingRow } from "./listing-row";
import { NewListingForm } from "./new-listing-form";

export const metadata: Metadata = { title: "Listings" };
export const dynamic = "force-dynamic";

/**
 * O7 — what this business sells.
 *
 * ## Why this screen did not exist for a month
 *
 * `POST /experiences/{id}/revisions` was the only listing endpoint in the
 * operator contract, and it could not be driven: no read, no create, no way to
 * enumerate a listing's id, and a body of `additionalProperties: true` against
 * a schema the document did not define. Raised on yuvoy-api#63 and left
 * unbuilt rather than guessed at.
 *
 * The open question there — whether operators author listings in v1 at all —
 * was answered by the owner on 5 September: **they do.** The four endpoints
 * this screen needs went live the same day.
 *
 * ## Reachable before the account is LIVE, deliberately
 *
 * `GET /me` returns `account.blocking`, and this screen ignores it. "Writing
 * listings and uploading footage is exactly what they should be doing while we
 * verify their documents, and hiding it until they are live makes the wait
 * feel like a dead end." `AccountStanding` is on every page of the portal
 * already and says what is outstanding.
 */
export default async function ActivitiesPage() {
  const { token } = await requireOperator();
  const client = operatorApi(token);

  /*
    Both reads, together. The media list is not decoration here — it is the
    only way to answer "this listing has nothing to show", which is the thing
    an operator most needs to be told and cannot see anywhere else. A listing
    on sale with nothing attached is a black card in the traveller app, which
    is what `yuvoy.in` showed for months.

    "Nothing to show", not "no video": a photograph counts, and since
    yuvoy-api#119 this list can tell the two apart. What the notice is about is
    a listing with NEITHER.

    A failing media read must not cost the whole screen: the listings are the
    subject and the footage note is an extra, so it degrades to silence rather
    than to an error boundary. Same call `/calendar` makes about its picker.
  */
  const [listingResult, mediaResult, vocabularyResult] = await Promise.all([
    client.GET("/experiences", {}),
    client.GET("/media", {}).catch(() => null),
    /*
      The category and destination pickers (yuvoy-api#113). Cacheable and
      rarely-changing — "this changes when a destination opens, which is rare"
      — and, like the media read, never allowed to cost the whole screen: the
      categories are known at compile time from the request body's enum, so a
      failed read costs the LABELS and the destination list, not the form.
    */
    client.GET("/catalog/vocabulary", {}).catch(() => null),
  ]);
  if (listingResult.error) throw listingResult.error;

  const listings: OperatorExperience[] = orderListings(
    listingResult.data.experiences ?? [],
  );

  const media = mediaResult && !mediaResult.error ? mediaResult.data.items : [];
  const mediaCount = media?.length ?? 0;
  const attached = new Set(
    (media ?? [])
      .map((m) => m.listing?.experienceId)
      .filter((id): id is string => Boolean(id)),
  );

  const blank = listingsWithoutFootage(listings, attached);

  /*
    Real pickers, from the server's own vocabulary (yuvoy-api#113 — closed).

    Categories are built from the request body's ENUM and merely labelled from
    this response, so a failed read leaves a usable picker with prettified
    names rather than an empty one. Destinations are rows and have to come from
    the response; empty is a state the form renders.
  */
  const vocabulary: Vocabulary | null =
    vocabularyResult && !vocabularyResult.error ? vocabularyResult.data : null;
  const categories = categoryChoices(vocabulary);
  const destinations = destinationChoices(vocabulary);

  return (
    <Screen stageLabel="Listings">
      <p className="eyebrow text-terra-deep">What you sell</p>
      {/* "Listing" everywhere an operator edits — D-031 C10,
          yuvoy-operator#36. The nav said "Manage services" and the screen
          under it said "Activities", while the API calls them experiences
          and the admin console calls them listings. An operator read three
          of ours in a week. */}
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Listings
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        What you sell. Write it, send it to us, and it goes on sale when we have
        read it.
      </p>

      <SectionSwitch listings={listings.length} media={mediaCount} />

      {/*
        The cross-link, summarised before the list rather than only per row.
        An operator with six listings and one blank one should not have to
        scan for it.
      */}
      {blank.length > 0 ? (
        <Panel tone="alert" className="mt-6 p-4">
          <p className="text-terra-deep text-sm font-bold">
            {/*
              "no media", not "no video". A listing whose only attachment is a
              photograph is NOT counted here — a traveller sees the photograph,
              not a blank card — so saying "no video" about the ones that ARE
              counted would send an operator looking for a missing clip on a
              listing that has neither (yuvoy-api#119 made the two tellable
              apart; this notice is about having nothing at all).
            */}
            {blank.length === 1
              ? "One activity is on sale with nothing to show."
              : `${blank.length} activities are on sale with nothing to show.`}
          </p>
          <p className="text-forest/80 mt-1.5 text-sm">
            Travellers see a blank card until a photograph or a reel is
            attached. Add one on{" "}
            <a href="/services/reels" className="underline underline-offset-2">
              Reels
            </a>
            .
          </p>
        </Panel>
      ) : null}

      <div className="mt-6">
        <NewListingForm
          vocabulary={vocabulary}
          categories={categories}
          destinations={destinations}
          market={marketName(vocabulary)}
        />
      </div>

      <section className="mt-10" aria-labelledby="your-activities">
        <h2 id="your-activities" className="label text-forest/75">
          {listings.length === 1
            ? "1 activity"
            : `${listings.length} activities`}
        </h2>

        {listings.length === 0 ? (
          <div className="mt-3">
            <Empty
              title="Nothing here yet"
              body="Add the first thing you run. It saves as a draft and reaches nobody until you send it to us."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-4">
            {listings.map((listing) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                vocabulary={vocabulary}
                hasFootage={
                  listing.id !== undefined && attached.has(listing.id)
                }
              />
            ))}
          </ul>
        )}
      </section>
    </Screen>
  );
}
