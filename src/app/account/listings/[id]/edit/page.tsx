import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { operatorApi } from "@/lib/api/server-client";
import { OperatorApiError } from "@/lib/api/errors";
import {
  STEP_LABEL,
  openingStep,
  previousStep,
  nextStep,
  readStep,
  unfinishedSteps,
} from "@/lib/services/builder";
import { categoryChoices, destinationChoices } from "@/lib/services/vocabulary";
import { Screen } from "@/components/chrome/screen";
import { Problem } from "@/components/ui/states";
import { ListingRow } from "@/components/listings/listing-row";
import { Stepper } from "../../steps/stepper";
import { BasicsStep } from "../../steps/basics";
import { SellingStep } from "../../steps/selling";
import { ScheduleStep } from "../../steps/schedule";
import { LocationStep } from "../../steps/location";
import { QuestionsStep } from "../../steps/questions";
import { MediaStep } from "../../steps/media";
import { ReviewStep } from "../../steps/review";

export const metadata: Metadata = { title: "Edit listing" };
export const dynamic = "force-dynamic";

/**
 * Editing a listing, which is two different screens — yuvoy-operator#58.
 *
 * ## A draft is built, a published listing is amended
 *
 * A draft opens the seven-step builder (item 7): one draft saved step by step,
 * with no completeness check and no review, because "each step has to be
 * saveable on its own, or a reel stalling on island 4G takes the half-written
 * listing with it". Anything already published opens the revision form (item
 * 6), which is a different act: it proposes a change to something travellers
 * are booking against, and it goes to a person.
 *
 * ## In review means there is nothing to do here
 *
 * `in_review` and `live_changes_in_review` redirect to the listing. Somebody at
 * Yuvoy is reading it, and an edit landing mid-review either loses their work
 * or changes what is being reviewed underneath them.
 *
 * ## Which step opens
 *
 * `?step=` when the URL names one. Otherwise the earliest step still holding a
 * `publishBlockers` field, and Review when none is. Nothing is remembered
 * anywhere: the draft is the only state, which is what makes a half-built
 * listing survive a phone going flat on a jetty.
 */
export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step: askedStep } = await searchParams;
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

  const back = { href: `/account/listings/${id}`, label: "the listing" };

  /* ------------------------------------------ a published listing (item 6) */

  if (status !== "draft") {
    return (
      <Screen nav={{ back }} stageLabel="Edit listing">
        <h1 className="font-display tracking-display text-4xl leading-[1.05]">
          Edit
        </h1>
        <p className="text-forest/70 mt-3 text-base">{listing.title}</p>

        {/*
          A list of one. `ListingRow` is an `<li>` — it was written for the list
          it came from — and an `li` with no list around it is an accessibility
          violation rather than a cosmetic one: a screen reader announces the
          row without ever saying there is a row.
        */}
        <ul className="mt-6">
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

  /* ----------------------------------------------- a draft: the builder -- */

  const blockers = listing.publishBlockers ?? [];
  const step = askedStep ? readStep(askedStep) : openingStep(blockers);
  const unfinished = unfinishedSteps(blockers);
  const href = (to: ReturnType<typeof nextStep>) =>
    to ? `/account/listings/${id}/edit?step=${to}` : `/account/listings/${id}`;
  const backHref = href(previousStep(step));
  const nextHref = href(nextStep(step));

  /*
    The documents this kind of listing needs, read only on Review. It is the one
    step that shows them, and the call needs a category the earlier steps may
    not have set yet. A failed read is named as unknown rather than as "none":
    "empty means a listing in this category needs none", which is a different
    answer.
  */
  const documents =
    step === "review" && listing.category
      ? await operatorApi(token)
          .GET("/credential-requirements", {
            params: {
              query: {
                category: listing.category,
                ...(listing.activityType
                  ? { activityType: listing.activityType }
                  : {}),
              },
            },
          })
          .then((r) => (r.error ? null : (r.data.documents ?? [])))
          .catch(() => null)
      : [];

  return (
    <Screen nav={{ back }} stageLabel="Add a listing">
      <p className="eyebrow text-terra-deep">Step {STEP_LABEL[step]}</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        {listing.title || "Your listing"}
      </h1>

      <Stepper id={id} current={step} unfinished={unfinished} />

      {step === "basics" ? (
        <BasicsStep
          id={id}
          vocabulary={vocabulary}
          categories={categoryChoices(vocabulary)}
          destinations={destinationChoices(vocabulary)}
          listing={listing}
        />
      ) : step === "selling" ? (
        <SellingStep
          id={id}
          listing={listing}
          commissionRateBps={me.commissionRateBps}
          back={backHref}
        />
      ) : step === "schedule" ? (
        <ScheduleStep
          id={id}
          repeatsWeekly={Boolean(listing.schedule?.repeatsWeekly)}
          weekly={(listing.schedule?.weekly ?? []).map((row) => ({
            weekday: row.weekday ?? 0,
            startTime: row.startTime ?? "07:00",
            seats: row.seats ?? 1,
          }))}
          back={backHref}
          next={nextHref}
        />
      ) : step === "location" ? (
        <LocationStep
          id={id}
          listing={listing}
          vocabulary={vocabulary}
          back={backHref}
        />
      ) : step === "questions" ? (
        <QuestionsStep
          id={id}
          questions={(workspace.questions ?? []).map((q) => ({
            ...(q.id ? { id: q.id } : {}),
            text: q.text ?? "",
            answerType: (q.answerType ?? "short_text") as
              "short_text" | "choice" | "yes_no",
            options: q.options ?? [],
            required: q.required ?? false,
          }))}
          back={backHref}
        />
      ) : step === "media" ? (
        <MediaStep
          id={id}
          title={listing.title ?? "this listing"}
          media={workspace.media ?? []}
          back={backHref}
          next={nextHref}
        />
      ) : (
        <ReviewStep
          id={id}
          listing={listing}
          questionCount={(workspace.questions ?? []).length}
          mediaCount={(workspace.media ?? []).length}
          departureCount={(workspace.departures ?? []).length}
          documents={documents}
        />
      )}
    </Screen>
  );
}
