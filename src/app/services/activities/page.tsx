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
import { SectionSwitch } from "../section-switch";
import { ListingRow } from "./listing-row";
import { NewListingForm } from "./new-listing-form";

export const metadata: Metadata = { title: "Activities" };
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
    only way to answer "this activity has no video", which is the thing an
    operator most needs to be told and cannot see anywhere else. A listing on
    sale with no clip attached is a black card in the traveller app, which is
    what `yuvoy.in` showed for months.

    A failing media read must not cost the whole screen: the listings are the
    subject and the footage note is an extra, so it degrades to silence rather
    than to an error boundary. Same call `/capacity` makes about its picker.
  */
  const [listingResult, mediaResult] = await Promise.all([
    client.GET("/experiences", {}),
    client.GET("/media", {}).catch(() => null),
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
    The operator's own vocabulary, offered back to them.

    The operator contract has no way to enumerate categories or destination
    keys — `category` is a bare string and `destination` is "a destination key
    in your own market" with nothing that lists a market's keys. A picker built
    from a hardcoded list would be this portal inventing a vocabulary the
    server owns, which is the one thing it must not do.

    So the suggestions come from what they already have. Their second listing
    is a tap; their first is typed against an example and refused with the
    API's own message if it is wrong. Raised on yuvoy-api rather than papered
    over.
  */
  const categories = [
    ...new Set(listings.map((l) => l.category).filter(Boolean)),
  ] as string[];
  const destinations = [
    ...new Set(listings.map((l) => l.destination).filter(Boolean)),
  ] as string[];

  return (
    <Screen stageLabel="Services">
      <p className="eyebrow text-terra-deep">Manage services</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Activities
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        What you sell. Write it, send it to us, and it goes on sale when we have
        read it.
      </p>

      <SectionSwitch activities={listings.length} reels={mediaCount} />

      {/*
        The cross-link, summarised before the list rather than only per row.
        An operator with six listings and one blank one should not have to
        scan for it.
      */}
      {blank.length > 0 ? (
        <Panel tone="alert" className="mt-6 p-4">
          <p className="text-terra-deep text-sm font-bold">
            {blank.length === 1
              ? "One activity is on sale with no video."
              : `${blank.length} activities are on sale with no video.`}
          </p>
          <p className="text-forest/80 mt-1.5 text-sm">
            Travellers see a blank card until a clip is attached. Upload one on{" "}
            <a href="/services/reels" className="underline underline-offset-2">
              Reels
            </a>
            .
          </p>
        </Panel>
      ) : null}

      <div className="mt-6">
        <NewListingForm categories={categories} destinations={destinations} />
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
