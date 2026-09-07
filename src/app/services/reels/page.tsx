import type { Metadata } from "next";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import { Screen } from "@/components/chrome/screen";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";
import {
  countLibrary,
  describeKind,
  describeMissingPreview,
  canWithdraw,
  unattached,
  type MediaItem,
} from "@/lib/services/media";
import { AttachForm, type ListingOption } from "./attach-form";
import { Uploader } from "./uploader";
import { PhotoUploader } from "./photo-uploader";
import { SectionSwitch } from "../section-switch";
import { WithdrawForm } from "./withdraw-form";

export const metadata: Metadata = { title: "Photos & reels" };
export const dynamic = "force-dynamic";

const stateCopy: Record<string, { label: string; body: string }> = {
  uploaded: { label: "Uploaded", body: "The media host is processing it." },
  processing: { label: "Processing", body: "The media host is preparing it." },
  ready: { label: "Needs rights", body: "Confirm who owns this." },
  attested: {
    label: "Waiting for review",
    body: "A person at Yuvoy will watch it.",
  },
  in_moderation: {
    label: "In review",
    body: "A person at Yuvoy is checking it.",
  },
  approved: { label: "Approved", body: "Choose the listing it belongs to." },
  published: {
    label: "Attached",
    body: "This is available to travellers.",
  },
  rejected: {
    label: "Not accepted",
    body: "This one did not pass review.",
  },
  quarantined: {
    label: "Held for safety review",
    body: "Yuvoy will contact you.",
  },
  /*
    The row carries the whole truth, because the panel that used to cannot
    survive the write.

    Withdrawing revalidates — the list has to stop showing a clip as live the
    moment it is not — and that re-render unmounts the form's own success
    panel. So the sentence the operator needs lives here instead, permanently
    and on the row it is about, rather than in something that vanishes.

    Both halves, and only what has happened: "it comes off Yuvoy immediately,
    and the original is deleted at the video provider shortly afterwards by a
    job." The second is a promise about a job, not a fact, and is worded as
    one.
  */
  withdrawn: {
    label: "Taken down",
    body: "It is off Yuvoy. The original is deleted at the video provider shortly afterwards.",
  },
  failed: { label: "Upload failed", body: "Choose the file again to retry." },
};

function mediaCopy(state?: string) {
  return (
    stateCopy[state ?? ""] ?? {
      label: state ?? "Unknown",
      body: "Check again shortly.",
    }
  );
}

function duration(seconds?: number) {
  if (!seconds) return null;
  return `${Math.round(seconds)} sec`;
}

export default async function ReelsPage() {
  const { token } = await requireOperator();
  const client = operatorApi(token);

  const [mediaResult, experienceResult] = await Promise.all([
    client.GET("/media", {}),
    client.GET("/experiences", {}),
  ]);
  if (mediaResult.error) throw mediaResult.error;
  if (experienceResult.error) throw experienceResult.error;

  const items: MediaItem[] = mediaResult.data.items ?? [];

  // Approved, and on nothing. See `unattached` for why only `approved` counts.
  const waiting = unattached(items);
  const listings: ListingOption[] = (experienceResult.data.experiences ?? [])
    .filter((item) => item.id && item.title)
    .map((item) => ({ id: item.id!, title: item.title!, status: item.status }));

  return (
    /*
      A tab root, not a focused screen. Reels lived behind the Business door
      with a back disc out to it; since yuvoy-operator#22 it is one half of
      Manage services, and an operator moves between these two lists
      constantly — "this activity has no video" and "this clip is attached to
      nothing" are the same question from both ends. A back control that left
      the section would be in the way every time.
    */
    <Screen stageLabel="Services">
      <p className="eyebrow text-terra-deep">Manage services</p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        Photos &amp; reels
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Upload the real experience, let Yuvoy review it, then attach it to the
        right listing. A photograph travels the same road as a clip.
      </p>

      <SectionSwitch activities={listings.length} reels={items.length} />

      {/*
        The cross-link, asked from the footage's end.

        `listing` on a media item is "absent means attached to nothing, which
        is exactly where a reel sits between finishing upload and appearing
        anywhere". That absence is the loudest thing this screen can say: an
        approved clip attached to nothing is work already done that no
        traveller can see.
      */}
      {waiting.length > 0 ? (
        <Panel tone="alert" className="mt-6 p-4">
          <p className="text-terra-deep text-sm font-bold">
            {/*
              Says WHAT is waiting, now that it can. "One approved clip" was
              wrong the moment a photograph could be the thing waiting, and an
              operator who reads "clip" goes looking for a video.
            */}
            {waiting.length === 1
              ? `One approved ${describeKind(waiting[0].kind)?.one ?? "item"} is not on any activity.`
              : `${countLibrary(waiting)} are approved and not on any activity.`}
          </p>
          <p className="text-forest/80 mt-1.5 text-sm">
            Nobody can see it until it is attached. Choose a listing on the row
            below.
          </p>
        </Panel>
      ) : null}

      <Panel className="mt-8">
        <h2 className="font-display text-2xl">Add a reel</h2>
        <p className="text-forest/70 mt-2 text-sm">
          Upright, up to 60 seconds. Losing signal pauses the upload instead of
          starting it again.
        </p>
        <div className="mt-5">
          <Uploader />
        </div>
      </Panel>

      {/*
        Photographs — yuvoy-operator#27.

        A separate panel rather than a mode on the one above: the two share
        nothing before `complete` (different host, different limits, no tus, no
        single-slot quota) and everything after it. Folding them together would
        have meant one component whose every branch asks which kind it is.

        Their ceilings are separate too — 20 each — "so a full gallery never
        blocks a reel and a full reel library never blocks a photograph."
      */}
      <Panel className="mt-6">
        <h2 className="font-display text-2xl">Add a photograph</h2>
        <p className="text-forest/70 mt-2 text-sm">
          For a listing that has no footage yet, or to show what a clip cannot.
          Reviewed by a person, exactly like a reel.
        </p>
        <div className="mt-5">
          <PhotoUploader />
        </div>
      </Panel>

      <section className="mt-12" aria-labelledby="your-reels">
        <div className="flex items-end justify-between gap-4">
          <h2 id="your-reels" className="font-display text-3xl">
            Your media
          </h2>
          {/*
            Counted by kind — yuvoy-api#119. This used to read "8 items",
            which was true and answered neither of the two questions an
            operator opens this screen with: which of my photos is still
            waiting, and did my reel get approved.

            `countLibrary` still falls back to a plain count when nothing can
            be named, because the rule that produced the old wording has not
            changed: a kind is read, never inferred.
          */}
          <span className="label text-forest/70">{countLibrary(items)}</span>
        </div>

        {items.length === 0 ? (
          <Panel className="mt-4">
            <p className="text-sm">
              Nothing yet. The first photograph or reel will appear here.
            </p>
          </Panel>
        ) : (
          <ul className="mt-4 space-y-4">
            {items.map((item) => {
              const copy = mediaCopy(item.state);
              const kind = describeKind(item.kind);
              // What the frame says when there is no picture — and there
              // usually is not. See `describeMissingPreview`.
              const missing = item.posterUrl
                ? null
                : describeMissingPreview(item);
              return (
                <li key={item.id}>
                  <Panel>
                    {/*
                      The picture, at EVERY state rather than only when
                      published — and only when there is one.

                      Both halves changed with yuvoy-api#119. The gate used to
                      be `state === "published" && posterUrl`, which was right
                      when clips were the only thing here and only a published
                      one had a poster. It is wrong for a photograph twice
                      over: the picture IS the item, so an operator has to see
                      which one they are looking at while it waits for review,
                      and the API now builds that URL at read time in every
                      state.

                      The absence is the commoner case and needs no special
                      handling here beyond not assuming: `posterUrl` is
                      "absent on most clips today", because a poster is only
                      stored once the provider has produced one and an
                      unpublished clip has no public URL. 270 of 342 clips had
                      none when this was written. That is yuvoy-api#121 and is
                      not ours to fix; what IS ours is that such a row still
                      renders as something an operator can read, which is why
                      the frame below is drawn either way.
                    */}
                    <div
                      className={cn(
                        "bg-forest/5 rounded-control max-h-80 w-full bg-cover bg-center",
                        // 9:16 for a reel, gentler for a photograph. See
                        // `describeKind`. An unnamed kind gets the shallow
                        // frame: it wastes less of the screen when wrong.
                        kind?.frame ?? "aspect-[4/3]",
                        !item.posterUrl &&
                          "flex items-center justify-center border border-dashed",
                        /*
                          A refused or broken row is drawn differently from one
                          that is simply on its way. yuvoy-operator#29: "a
                          single grey box flattens them", and the difference an
                          operator needs at a glance is whether anything is
                          wrong at all.
                        */
                        !item.posterUrl &&
                          (missing?.faulted
                            ? "border-terra-deep/40"
                            : "border-cream-line"),
                      )}
                      style={
                        item.posterUrl
                          ? {
                              backgroundImage: `url(${JSON.stringify(item.posterUrl).slice(1, -1)})`,
                            }
                          : undefined
                      }
                      {...(item.posterUrl
                        ? {
                            role: "img",
                            "aria-label": kind
                              ? `${kind.label} preview`
                              : "Preview",
                          }
                        : {})}
                    >
                      {/*
                        No picture. Said, rather than left as a grey rectangle
                        somebody has to interpret — and it says WHY, because
                        "no preview" reads as "something went wrong with my
                        upload" to the person who just spent twenty minutes of
                        island uplink on it.
                      */}
                      {/*
                        Full-strength forest, not the `/70` the rest of this
                        panel uses. `text-forest/70` on the tinted frame
                        measures 4.36:1 against `cream-deep` — under the 4.5 AA
                        floor for 12px text — and axe on /services/reels caught
                        it, which looking at it would not have. The tint is what
                        makes an empty frame read as a frame, so the text moves
                        rather than the ground.

                        An empty `line` is deliberate, not a bug: a refused row
                        says nothing about the picture, because the reviewer's
                        reason below is the thing that matters and "no preview
                        yet" would read as a technical hiccup instead.
                      */}
                      {missing?.line ? (
                        <p className="text-forest px-6 text-center text-xs">
                          {missing.line}
                        </p>
                      ) : null}
                    </div>

                    <div className="mt-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          tone={
                            item.state === "approved" ? "selected" : "neutral"
                          }
                        >
                          {copy.label}
                        </Chip>
                        {/*
                          Which of the two this is — the whole point of
                          yuvoy-api#119. Absent rather than guessed when the
                          API did not say: a row with no kind chip is honest,
                          a row labelled "Photograph" because a clip had not
                          finished processing is not.
                        */}
                        {kind ? <Chip>{kind.label}</Chip> : null}
                        {duration(item.durationSeconds) ? (
                          <span className="text-forest/70 text-xs">
                            {duration(item.durationSeconds)}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm font-bold">{copy.body}</p>

                      {item.listing?.title ? (
                        <p className="text-forest/70 mt-2 text-sm">
                          Listing: {item.listing.title}
                        </p>
                      ) : null}

                      {item.rejection?.code ? (
                        <div className="border-terra-deep/30 mt-3 border-t pt-3">
                          <p className="text-terra-deep text-sm font-bold">
                            {item.rejection.code
                              .replaceAll("_", " ")
                              .toLowerCase()}
                          </p>
                          {item.rejection.note ? (
                            <p className="text-forest/70 mt-1 text-sm">
                              {item.rejection.note}
                            </p>
                          ) : null}
                        </div>
                      ) : null}

                      {item.state === "approved" && item.id ? (
                        listings.length > 0 ? (
                          <AttachForm
                            mediaAssetId={item.id}
                            listings={listings}
                          />
                        ) : (
                          <p className="text-terra-deep mt-4 text-sm font-bold">
                            Add a listing first, then come back to attach this
                            {kind ? ` ${kind.one}` : " one"}.{" "}
                            <a
                              href="/services/activities"
                              className="underline underline-offset-2"
                            >
                              Your activities
                            </a>
                          </p>
                        )
                      ) : null}

                      {/*
                        Taking it down, from the library.

                        `POST /media/{id}/withdraw` has existed since O8 and
                        could only be reached for the clip just uploaded, while
                        its submission panel was on screen — the wrong file
                        noticed immediately. That is the case that actually
                        happens, but it is not the endpoint yuvoy-operator#9
                        describes, and `GET /media` is what makes the rest of
                        it reachable.

                        Offered only where there is something to take down. A
                        clip mid-upload, one already withdrawn and one a
                        reviewer refused are all things the operator cannot
                        act on, and a button that 404s teaches them to distrust
                        the screen.
                      */}
                      {canWithdraw(item) ? (
                        <WithdrawForm
                          mediaAssetId={item.id!}
                          attachedTo={item.listing?.title}
                        />
                      ) : null}
                    </div>
                  </Panel>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Screen>
  );
}
