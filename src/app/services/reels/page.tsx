import type { Metadata } from "next";
import { operatorApi } from "@/lib/api/server-client";
import { requireOperator } from "@/lib/auth/session";
import { Screen } from "@/components/chrome/screen";
import { Chip } from "@/components/ui/chip";
import { Panel } from "@/components/ui/panel";
import { AttachForm, type ListingOption } from "./attach-form";
import { Uploader } from "./uploader";
import { SectionSwitch } from "../section-switch";

export const metadata: Metadata = { title: "Reels" };
export const dynamic = "force-dynamic";

type MediaItem = {
  id?: string;
  state?: string;
  posterUrl?: string;
  durationSeconds?: number;
  createdAt?: string;
  rejection?: { code?: string; note?: string };
  listing?: { experienceId?: string; title?: string; state?: string };
};

const stateCopy: Record<string, { label: string; body: string }> = {
  uploaded: { label: "Uploaded", body: "The video host is processing it." },
  processing: { label: "Processing", body: "The video host is preparing it." },
  ready: { label: "Needs rights", body: "Confirm who owns this footage." },
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
    body: "This clip is available to travellers.",
  },
  rejected: {
    label: "Needs a new clip",
    body: "This one did not pass review.",
  },
  quarantined: {
    label: "Held for safety review",
    body: "Yuvoy will contact you.",
  },
  withdrawn: { label: "Taken down", body: "This clip is no longer on Yuvoy." },
  failed: { label: "Upload failed", body: "Choose the clip again to retry." },
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

  /*
    Approved, and on nothing. Only `approved` counts: a clip still in review is
    not work waiting on the operator, and saying so about every unfinished
    upload would make the notice worth ignoring.
  */
  const unattached = items.filter(
    (m) => m.state === "approved" && !m.listing?.experienceId,
  ).length;
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
        Reels
      </h1>
      <p className="text-forest/70 mt-3 text-base">
        Upload the real experience, let Yuvoy review it, then attach the
        approved clip to the right listing.
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
      {unattached > 0 ? (
        <Panel tone="alert" className="mt-6 p-4">
          <p className="text-terra-deep text-sm font-bold">
            {unattached === 1
              ? "One approved clip is not on any activity."
              : `${unattached} approved clips are not on any activity.`}
          </p>
          <p className="text-forest/80 mt-1.5 text-sm">
            Nobody can see it until it is attached. Choose a listing on the clip
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

      <section className="mt-12" aria-labelledby="your-reels">
        <div className="flex items-end justify-between gap-4">
          <h2 id="your-reels" className="font-display text-3xl">
            Your reels
          </h2>
          <span className="label text-forest/70">
            {items.length} {items.length === 1 ? "clip" : "clips"}
          </span>
        </div>

        {items.length === 0 ? (
          <Panel className="mt-4">
            <p className="text-sm">
              No clips yet. The first upload will appear here.
            </p>
          </Panel>
        ) : (
          <ul className="mt-4 space-y-4">
            {items.map((item) => {
              const copy = mediaCopy(item.state);
              return (
                <li key={item.id}>
                  <Panel>
                    {item.state === "published" && item.posterUrl ? (
                      <div
                        className="bg-forest/10 rounded-control aspect-[9/16] max-h-80 w-full bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${JSON.stringify(item.posterUrl).slice(1, -1)})`,
                        }}
                        role="img"
                        aria-label="Reel poster"
                      />
                    ) : null}

                    <div
                      className={
                        item.state === "published" && item.posterUrl
                          ? "mt-4"
                          : ""
                      }
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip
                          tone={
                            item.state === "approved" ? "selected" : "neutral"
                          }
                        >
                          {copy.label}
                        </Chip>
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
                            clip.
                          </p>
                        )
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
