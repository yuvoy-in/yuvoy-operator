import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError } from "@/lib/api/errors";
import { describeBlockers, describeRejection } from "@/lib/services/listings";
import { listingLabel, posterFor } from "@/lib/services/home";
import { ReelsTab } from "@/app/account/reels-tab";
import { Screen } from "@/components/chrome/screen";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { ButtonLink } from "@/components/ui/button";
import { SubmitButton } from "./submit-button";

export const metadata: Metadata = { title: "Listing" };
export const dynamic = "force-dynamic";

/**
 * One listing, as the profile shows it — yuvoy-operator#58 item 4.
 *
 * ## Not the same screen as Home's hub
 *
 * `/today/listing/{id}` is where a listing is RUN: its departures, their times,
 * their seats. This is where it is made and mended: why a reviewer sent it
 * back, what it is still missing, and the way to fix and resend. Two screens
 * because they answer two questions, and an operator arrives at each from a
 * different place with a different thing on their mind.
 *
 * ## What it shows depends entirely on the state
 *
 * A sent-back listing leads with the reason, because that is the only thing
 * worth reading. A draft leads with what is missing. A live one has nothing to
 * say but Edit. And one in review has no buttons at all: there is nothing an
 * operator can usefully do while somebody is looking at it, and a control that
 * answered `409` would be worse than the absence.
 */
export default async function ListingPage({
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
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  const listing = workspace.listing ?? {};
  const media = workspace.media ?? [];
  const status = listing.status ?? "";
  const suspended = Boolean(me.suspension);
  const canAct = me.canManage && !suspended;
  const poster = posterFor(media, id);

  /*
    Every listing, so the sheet's "put it on another listing" has somewhere to
    put one. A soft read: a failed listings call must not take this screen down
    when everything above it came from the workspace.
  */
  const listingOptions = await operatorApi(token)
    .GET("/experiences", {})
    .then((r) =>
      r.error
        ? []
        : (r.data.experiences ?? [])
            .filter((e) => e.id && e.title)
            .map((e) => ({ id: e.id!, title: e.title!, status: e.status })),
    )
    .catch(() => []);

  const sentBack = listing.sentBack;
  const blockers = describeBlockers(listing.publishBlockers);
  const inReview =
    status === "in_review" || status === "live_changes_in_review";

  return (
    <Screen
      nav={{ back: { href: "/account", label: "your business" } }}
      stageLabel="Listing"
    >
      {poster ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster}
          alt=""
          className="rounded-card aspect-[3/2] w-full object-cover"
        />
      ) : null}

      <div className="mt-4 flex items-start justify-between gap-3">
        <h1 className="font-display tracking-display text-3xl leading-tight">
          {listing.title}
        </h1>
        <Chip>{listingLabel(listing)}</Chip>
      </div>

      {/*
        Why it came back, first. "The description was not clear enough to sell
        from" is the only thing on this screen worth reading when it is there,
        and the reviewer's own note goes under the code's sentence rather than
        replacing it: the code is the category and the note is about this
        listing.
      */}
      {sentBack ? (
        <Panel tone="alert" className="mt-4 p-4">
          <p className="text-sm font-bold">
            Sent back:{" "}
            {describeRejection(sentBack.rejectionCode) ??
              sentBack.rejectionNote}
          </p>
          {describeRejection(sentBack.rejectionCode) &&
          sentBack.rejectionNote ? (
            <p className="text-forest/80 mt-1.5 text-sm">
              {sentBack.rejectionNote}
            </p>
          ) : null}
        </Panel>
      ) : status === "draft" && blockers.length > 0 ? (
        <Panel tone="alert" className="mt-4 p-4">
          <p className="text-sm font-bold">
            Still missing: {blockers.join(", ")}
          </p>
        </Panel>
      ) : status === "changes_rejected" && listing.review ? (
        <Panel tone="alert" className="mt-4 p-4">
          <p className="text-sm font-bold">
            Changes declined:{" "}
            {describeRejection(listing.review.rejectionCode) ??
              listing.review.rejectionNote}
          </p>
        </Panel>
      ) : null}

      {/*
        `not_selling` is the state a client cannot infer: the listing IS
        published and is still absent from every feed. The reason lives on the
        account, so the link goes there rather than this screen guessing.
      */}
      {status === "not_selling" ? (
        <Link
          href="/account/verification"
          className="text-terra-deep tap-target mt-3 block text-sm font-bold underline underline-offset-4"
        >
          See what is outstanding
        </Link>
      ) : null}

      {canAct && !inReview ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <ButtonLink
            href={`/account/listings/${id}/edit`}
            variant="secondary"
            block={false}
          >
            Edit
          </ButtonLink>
          {sentBack ? (
            <SubmitButton experienceId={id} label="Send again" />
          ) : status === "draft" ? (
            <SubmitButton experienceId={id} label="Send for review" />
          ) : null}
        </div>
      ) : null}

      {/*
        The way to run it, for a listing that exists as far as travellers are
        concerned. A draft has no departures worth managing.
      */}
      {listing.publicationState === "published" ||
      listing.publicationState === "withdrawn" ? (
        <Link
          href={`/today/listing/${id}`}
          className="text-forest tap-target mt-4 block text-sm underline underline-offset-2"
        >
          Run it: departures, times and seats
        </Link>
      ) : null}

      <section className="mt-10" aria-labelledby="listing-media">
        <h2 id="listing-media" className="label text-forest/75">
          Its reels and photographs
        </h2>
        {/*
          Tapping one opens its sheet — #58 item 4, the same sheet the profile's
          Reels tab opens (item 6). One component, so a reel offers the same
          six actions wherever it is met.
        */}
        <ReelsTab
          media={media}
          listings={listingOptions}
          suspended={Boolean(me.suspension)}
          emptyLine="Nothing on it yet"
          offerAdd={false}
        />
      </section>
    </Screen>
  );
}
