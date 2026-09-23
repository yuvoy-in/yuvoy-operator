import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError } from "@/lib/api/errors";
import {
  listingLabel,
  liveWithNothingToSell,
  withinFortnight,
} from "@/lib/services/home";
import { shiftDay } from "@/lib/day/calendar";
import type { OperatorSlot } from "@/lib/day/types";
import { formatPaise } from "@/lib/format/money";
import { dayCaption, marketDays } from "@/lib/format/market-time";
import { travellerAppOrigin } from "@/lib/site/traveller-app";
import { Screen } from "@/components/chrome/screen";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { Problem } from "@/components/ui/states";
import { ButtonLink } from "@/components/ui/button";
import { PauseResume } from "@/components/listings/pause-resume";
import { ConfirmSeats } from "@/components/listings/confirm-seats";
import { ScheduleForm } from "./schedule-form";
import { DepartureRow } from "./departure-row";

export const metadata: Metadata = { title: "Listing" };
export const dynamic = "force-dynamic";

/*
  Back to Business, not to Home: listings live under Business now, so that is
  where somebody who came here from a listing expects to land. A focused
  screen's way back is a stated fallback rather than `history.back()`, so it
  has to name the place the listings are, whatever path was taken in.
*/
const BACK = { href: "/account", label: "your business" };

/**
 * One listing, and everything that can be done to it — yuvoy-operator#56
 * items 6 to 9.
 *
 * ## One request, not three
 *
 * `GET /experiences/{id}/workspace` answers the listing, its departures, its
 * media and its questions together. The contract says why: "the pieces have
 * always been separate … building a listing meant fetching the whole calendar
 * and the whole media library to find the handful of rows that belong to it. On
 * island 4G that is three requests and most of a business's data to render one
 * screen."
 *
 * ## What is running comes first (yuvoy-operator#85 s8)
 *
 * "The operator came here to see what is running. Instead the first dark
 * button commits a form they have not filled in." The next departures come
 * straight after what the listing is, the weekly schedule under them with its
 * Save drawn only once something changed, and pausing the whole listing last:
 * it is the one control here that takes the listing off sale, so it is quiet
 * and at the foot. It stays in one place in every state, because its receipt
 * (what pausing did, and who is still owed a trip) must survive the re-read
 * that turns the listing Paused.
 *
 * ## What a STAFF login gets
 *
 * View as a traveller, and the way into each departure's manifest. "No sentence
 * explaining why": not offering a control already says it, and a paragraph
 * about roles on a screen full of things they cannot do is the screen arguing
 * with the reader.
 */
export default async function ListingHubPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { token, me } = await requireOperator();

  let workspace;
  try {
    const result = await operatorApi(token).GET("/experiences/{id}/workspace", {
      params: { path: { id } },
    });
    if (result.error) throw result.error;
    workspace = result.data;
  } catch (err) {
    // Another operator's listing answers 404, identically to one that does not
    // exist. Not a fault anybody can retry, so not the error boundary.
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  const listing = workspace.listing ?? {};
  const { today, tomorrow } = await marketDays();
  const fortnightEnd = shiftDay(today, 13);

  /*
    The workspace sends departures "that have not yet left, soonest first, up to
    200". Kept to the fortnight, because that is the window this screen is for:
    a listing with a year of weekly departures would otherwise put two hundred
    rows under a heading nobody scrolls.
  */
  const departures = withinFortnight(
    (workspace.departures ?? []) as OperatorSlot[],
    today,
    fortnightEnd,
  );

  const suspended = Boolean(me.suspension);
  const status = listing.status ?? "";
  const canEdit = status !== "in_review" && status !== "live_changes_in_review";
  const sellable =
    status === "live" ||
    status === "live_changes_in_review" ||
    (status === "changes_rejected" && !listing.sentBack);

  const price =
    listing.unitPricePaise === null || listing.unitPricePaise === undefined
      ? "No price yet"
      : `${formatPaise(listing.unitPricePaise)} ${
          listing.pricingUnit === "per_group" ? "for the group" : "per person"
        }`;

  /* Departures grouped by their own market day, for the captions below. */
  const byDay = new Map<string, OperatorSlot[]>();
  for (const slot of departures) {
    const day = new Intl.DateTimeFormat("en-CA", {
      timeZone: slot.timezone,
    }).format(new Date(slot.startsAt));
    byDay.set(day, [...(byDay.get(day) ?? []), slot]);
  }

  return (
    <Screen nav={{ back: BACK }}>
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display tracking-display text-4xl leading-[1.05]">
          {listing.title}
        </h1>
        <Chip>{listingLabel(listing)}</Chip>
      </div>

      {/*
        On the traveller app and nothing to book (op#95 item 3): "a published
        listing reading 0 is on the traveller app and sells nothing". Said
        before anything else on the page, because it is lost money the operator
        can fix here, with the schedule below.
      */}
      {liveWithNothingToSell(listing) ? (
        <div className="mt-4">
          <Problem
            title="Live, but no dates in the next 30 days"
            body="Travellers can see this listing and cannot book it. Add departures, or set a weekly schedule below."
          />
        </div>
      ) : null}

      {/*
        Departures this listing has off sale, or about to go off sale, because
        nobody confirmed their seats (op#94). Mounted for every manager so the
        receipt survives the re-read that brings the counts to 0.
      */}
      {me.canManage && !suspended ? (
        <div className="mt-4">
          <ConfirmSeats
            experienceId={id}
            notOnSale={count(listing.departuresNotOnSale)}
            goingOffSoon={count(listing.departuresGoingOffSaleSoon)}
          />
        </div>
      ) : null}

      <p className="text-forest/80 mt-3 text-base">{price}</p>
      <p className="text-forest/70 mt-1 text-sm">
        {listing.durationMinutes ? `${listing.durationMinutes} minutes` : null}
        {listing.durationMinutes && listing.maxPartySize ? " · " : null}
        {listing.maxPartySize
          ? `Up to ${listing.maxPartySize} per booking`
          : null}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {/*
          Every control below is withheld from STAFF and from a suspended
          business, except the traveller preview: one is a role the API refuses,
          the other is an account that may not sell (#50). Neither gets a
          sentence about it.
        */}
        {me.canManage && !suspended && canEdit ? (
          <ButtonLink
            href={`/account/listings/${id}/edit`}
            variant="secondary"
            size="md"
            block={false}
          >
            Edit
          </ButtonLink>
        ) : null}
        {sellable && listing.slug ? (
          <ButtonLink
            href={`${travellerAppOrigin()}/e/${listing.slug}`}
            variant="secondary"
            size="md"
            block={false}
            target="_blank"
            rel="noreferrer"
          >
            View as a traveller
          </ButtonLink>
        ) : null}
      </div>

      <section className="mt-8" aria-labelledby="departures">
        <h2 id="departures" className="label text-forest/75">
          Next departures
        </h2>

        {byDay.size === 0 ? (
          <p className="text-forest/70 mt-2 text-base">
            Nothing scheduled in the next two weeks
          </p>
        ) : (
          <div className="mt-3 space-y-6">
            {[...byDay.entries()].map(([day, slots]) => (
              <div key={day}>
                <h3 className="label text-forest/75">
                  {dayCaption(day, today, tomorrow)}
                </h3>
                <Panel className="mt-2">
                  <ul className="space-y-3">
                    {slots.map((slot) => (
                      <DepartureRow
                        key={slot.id}
                        slot={slot}
                        day={day}
                        canManage={me.canManage}
                        suspended={suspended}
                      />
                    ))}
                  </ul>
                </Panel>
              </div>
            ))}
          </div>
        )}
      </section>

      {me.canManage && !suspended ? (
        <section className="mt-10" aria-labelledby="schedule">
          <h2 id="schedule" className="label text-forest/75">
            Weekly schedule
          </h2>
          <ScheduleForm
            experienceId={id}
            repeatsWeekly={listing.schedule?.repeatsWeekly === true}
            weekly={(listing.schedule?.weekly ?? []).map((row) => ({
              weekday: row.weekday ?? 1,
              startTime: row.startTime ?? "09:00",
              seats: row.seats ?? 8,
            }))}
          />
        </section>
      ) : null}

      {me.canManage && !suspended ? (
        <div className="border-paper-line mt-10 border-t pt-2">
          {/*
            The existing control, moved here unchanged (#56 item 7). #58 moves
            the file itself when the Listings pages move under Business.
          */}
          <PauseResume
            experienceId={id}
            title={listing.title ?? "this listing"}
            publicationState={listing.publicationState}
          />
        </div>
      ) : null}
    </Screen>
  );
}

/**
 * A count the API "always" sends, read as 0 when it did not: an older API
 * that sends neither count has nothing to confirm, which draws nothing.
 */
function count(value: number | undefined): number {
  return Number.isInteger(value) && (value as number) > 0
    ? (value as number)
    : 0;
}
