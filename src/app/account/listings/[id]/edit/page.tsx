import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError } from "@/lib/api/errors";
import { Screen } from "@/components/chrome/screen";
import { Problem } from "@/components/ui/states";
import { ListingRow } from "@/components/listings/listing-row";

export const metadata: Metadata = { title: "Edit listing" };
export const dynamic = "force-dynamic";

/**
 * The one edit screen — yuvoy-operator#58 item 6, and where Home's hub links.
 *
 * ## In review means nothing to do here
 *
 * "`status` is `in_review` or `live_changes_in_review` → redirect to
 * `/account/listings/{id}`." Somebody at Yuvoy is reading it, and an edit
 * landing mid-review either loses their work or changes what is being reviewed
 * underneath them. The listing screen says what state it is in, which is the
 * useful answer.
 *
 * ## What is NOT here
 *
 * Item 7's seven-step builder — one draft saved step by step through Basics,
 * Selling, Schedule, Location and safety, Questions, Media and Review. This is
 * the existing single form, which saves the same fields in one go: a draft
 * through `PATCH` and a published listing through a revision. The capability is
 * the same and the shape is not.
 */
export default async function EditListingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { token, me } = await requireOperator();

  if (!me.canManage || me.suspension) {
    return (
      <Screen
        nav={{
          back: { href: `/account/listings/${id}`, label: "the listing" },
        }}
        stageLabel="Edit listing"
      >
        <h1 className="font-display tracking-display text-3xl leading-tight">
          Edit
        </h1>
        <div className="mt-6">
          <Problem
            title="Only owners, admins and managers can edit a listing"
            body="A staff login runs the day. Ask an owner, an admin or a manager."
          />
        </div>
      </Screen>
    );
  }

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
  const status = listing.status ?? "";
  if (status === "in_review" || status === "live_changes_in_review") {
    redirect(`/account/listings/${id}`);
  }

  const vocabulary = await operatorApi(token)
    .GET("/catalog/vocabulary", {})
    .then((r) => (r.error ? null : r.data))
    .catch(() => null);

  return (
    <Screen
      nav={{ back: { href: `/account/listings/${id}`, label: "the listing" } }}
      stageLabel="Edit listing"
    >
      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        Edit
      </h1>
      <p className="text-forest/70 mt-3 text-base">{listing.title}</p>

      {/*
        A list of one. `ListingRow` is an `<li>` — it was written for the list
        it came from — and an `li` with no list around it is an accessibility
        violation rather than a cosmetic one: a screen reader announces the row
        without ever saying there is a row.
      */}
      <ul className="mt-6">
        {/*
          The existing row's own edit form, opened. It already holds the field
          rules, the "you receive" preview and the revision behaviour — a second
          form would be a second set of those, and the first thing to drift
          would be which fields a revision may carry.
        */}
        <ListingRow
          listing={listing}
          /*
            Whether anything is on it, from the workspace's own media rather
            than a second read. A listing on sale with no footage renders as a
            black card in the traveller app, and the row says so.
          */
          hasFootage={(workspace.media ?? []).length > 0}
          vocabulary={vocabulary}
          suspended={Boolean(me.suspension)}
        />
      </ul>
    </Screen>
  );
}
