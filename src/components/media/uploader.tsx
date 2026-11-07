"use client";

import { formatBytes, refuses } from "@/lib/media/preflight";
import { marketTime } from "@/lib/format/market-time";
import { RightsForm } from "./rights-form";
import { ListingPicker } from "./listing-picker";
import type { ListingOption } from "./attach-form";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { useUploader } from "./use-uploader";

/**
 * The four steps, as one screen that never loses its place.
 *
 * The person doing this is on a boat with one bar of signal and a 40 MB clip.
 * Everything below is arranged around that: nothing is uploaded before it has
 * been checked locally, the progress is real rather than a spinner, a dropped
 * connection is a pause rather than a failure, and the last step says plainly
 * that attesting is not publishing.
 */

export function Uploader({
  listings,
  fixedExperienceId,
}: {
  /** `null` means the listings could not be read. */
  listings: ListingOption[] | null;
  /**
   * The listing is already decided: the draft being built (#58 item 7), or the
   * listing a reel is being replaced on (#58 item 6). The picker is not drawn.
   */
  fixedExperienceId?: string;
}) {
  const {
    phase,
    setPhase,
    experienceId,
    setExperienceId,
    role,
    setRole,
    abort,
    pick,
    send,
  } = useUploader(fixedExperienceId);

  if (phase.name === "attesting") {
    return <RightsForm mediaAssetId={phase.mediaAssetId} />;
  }

  return (
    <div>
      {phase.name === "rejected" ? (
        <div>
          {phase.problems.map((p) => (
            <p
              key={p.message}
              role="alert"
              className="text-terra-deep text-sm font-bold"
            >
              {p.message}
            </p>
          ))}
          <Button
            onClick={() => setPhase({ name: "idle" })}
            variant="secondary"
            className="mt-4"
          >
            Choose a different clip
          </Button>
          {/* No intent was asked for, so the operator's single upload slot is
              untouched and the next choice starts clean. */}
          <p className="text-forest/70 mt-2 text-xs">
            Nothing was sent, and nothing was used up.
          </p>
        </div>
      ) : null}

      {phase.name === "held" ? (
        <div>
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {phase.by
              ? `This upload already holds ${formatBytes(phase.uploaded ?? 0)} of ${phase.by.name}.`
              : `An upload is already going for this business, and it is not this clip. ${formatBytes(phase.uploaded ?? 0)} of something else has arrived.`}
          </p>
          {/*
            One clip at a time is the API's rule. What CAN happen is said
            plainly, and it depends on whether the bytes can be named.

            Named: this phone started it, so "choose it again" is real advice.
            Unnamed: another device, a colleague, or storage that was cleared —
            and telling somebody to choose a clip nothing can name would be
            advice they cannot act on. So they get the one true fact instead,
            which is when the slot frees up.
          */}
          <p className="text-forest/70 leading-body mt-2 text-sm text-pretty">
            {phase.by ? (
              <>
                One clip at a time. Choose {phase.by.name} again and it carries
                on from where it stopped. This works after closing the tab or
                restarting your phone. A different clip cannot go in until that
                one finishes
              </>
            ) : (
              <>
                One clip at a time, and this browser did not start that one, so
                it cannot be picked up from here. Whoever did can carry on with
                it from their own phone. Anything else waits until it finishes
              </>
            )}
            {phase.intent.expiresAt
              ? ` or times out at ${marketTime(phase.intent.expiresAt, "Asia/Kolkata")}`
              : " or times out"}
            .
          </p>
          <Button
            onClick={() => setPhase({ name: "idle" })}
            variant="secondary"
            className="mt-4"
          >
            Pick a clip again
          </Button>
        </div>
      ) : null}

      {phase.name === "idle" || phase.name === "failed" ? (
        <>
          <div className="mb-5">
            <ListingPicker
              id="reel"
              listings={listings}
              fixedTitle={
                fixedExperienceId
                  ? ((listings ?? []).find((l) => l.id === fixedExperienceId)
                      ?.title ?? "this listing")
                  : undefined
              }
              value={experienceId}
              onChange={setExperienceId}
              role={role}
              onRoleChange={setRole}
              noun="clip"
            />
          </div>

          <label htmlFor="reel" className="label text-forest/75 block">
            Choose a clip
          </label>
          <input
            id="reel"
            type="file"
            accept="video/*"
            className={inputClass("mt-2 h-auto py-4")}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void pick(file);
            }}
          />
          {phase.name === "failed" &&
          phase.bound &&
          (phase.uploaded ?? 0) > 0 ? (
            /*
              The way back, said beside the way in. The slot is holding this
              clip's bytes; choosing it again is a resume, choosing another is
              a refusal.
            */
            <p className="text-forest/80 mt-2 text-xs">
              Choose {phase.bound.name} again and it carries on from{" "}
              {formatBytes(phase.uploaded ?? 0)}. Nothing already sent is sent
              twice.
            </p>
          ) : (
            <p className="text-forest/70 mt-2 text-xs">
              Filmed upright, on a phone, is exactly right. We check the length
              and the shape here before anything is sent.
            </p>
          )}
        </>
      ) : null}

      {phase.name === "checking" ? (
        <p className="text-base font-bold" role="status">
          Checking the clip…
        </p>
      ) : null}

      {phase.name === "ready" ? (
        <div>
          <p className="text-base font-bold">{phase.file.name}</p>
          <p className="text-forest/70 mt-1 text-sm">
            {formatBytes(phase.file.size)}
          </p>

          {phase.problems.map((p) => (
            <p
              key={p.message}
              role={p.severity === "refuse" ? "alert" : "status"}
              className={
                p.severity === "refuse"
                  ? "text-terra-deep mt-3 text-sm font-bold"
                  : "text-forest/80 leading-body mt-3 text-sm text-pretty"
              }
            >
              {p.message}
            </p>
          ))}

          {phase.resumeFrom > 0 ? (
            <p
              className="text-forest/80 leading-body mt-3 text-sm text-pretty"
              role="status"
            >
              Picks up from {formatBytes(phase.resumeFrom)} already uploaded.
              Nothing is sent twice.
            </p>
          ) : null}

          {refuses(phase.problems) ? (
            <Button
              onClick={() => setPhase({ name: "idle" })}
              variant="secondary"
              className="mt-4"
            >
              Choose a different clip
            </Button>
          ) : (
            <>
              <Button
                onClick={() => void send(phase.file, phase.intent)}
                className="mt-4"
              >
                Upload it
              </Button>
              {/*
                This line used to be a warning and is now a reassurance, which
                is the whole of yuvoy-api#66 §3 in one sentence. Asking for the
                intent again returns the upload in flight with a fresh URL, so
                a closed tab is recoverable rather than fatal.

                It still says to stay, because staying is quicker than coming
                back — and it says what happens if they cannot, because the
                person this screen was written for is holding a phone on a boat
                and the honest sentence is the one that stops them starting
                over from zero.
              */}
              <p className="text-forest/70 mt-3 text-xs">
                Best to stay on this page until it finishes. Losing signal is
                fine. It picks up where it left off. If the tab closes or your
                phone restarts, come back here and choose the same clip: it
                carries on from where it stopped.
              </p>
            </>
          )}
        </div>
      ) : null}

      {phase.name === "uploading" ? (
        <div>
          <p className="text-base font-bold text-balance">
            Uploading {phase.file.name}
          </p>
          {/*
            A real number, not a spinner. Twenty minutes of a progress bar that
            moves is a different experience from twenty minutes of one that
            might have stopped.
          */}
          <progress
            className="accent-forest mt-3 h-3 w-full"
            max={phase.file.size}
            value={phase.uploaded}
            aria-label="Upload progress"
          />
          <p className="text-forest/80 mt-2 text-sm tabular-nums" role="status">
            {formatBytes(phase.uploaded)} of {formatBytes(phase.file.size)}
            {phase.file.size > 0
              ? ` · ${Math.floor((phase.uploaded / phase.file.size) * 100)}%`
              : ""}
          </p>
          {phase.resumes > 0 ? (
            /*
              Named rather than hidden. The connection dropping is the common
              path here, and an operator who sees it recover once trusts the
              screen for the next twenty minutes.
            */
            <p className="text-forest/70 leading-body mt-2 text-sm text-pretty">
              The connection dropped {phase.resumes}{" "}
              {phase.resumes === 1 ? "time" : "times"} and picked up again.
              Nothing was lost.
            </p>
          ) : null}
          <Button
            onClick={() => abort.current?.abort()}
            variant="secondary"
            className="mt-4"
          >
            Stop
          </Button>
        </div>
      ) : null}

      {phase.name === "processing" ? (
        <div>
          <p className="text-base font-bold" role="status">
            Uploaded. We are processing it now.
          </p>
          {/*
            The bytes are safe either way. The reel list shows the clip while
            it is processing, and its rights can be attested from there once it
            is ready, but the rights step follows here the moment it is ready.
            So the ask is still to stay, and the way back is still said.
          */}
          <p className="text-forest/70 leading-body mt-2 text-sm text-pretty">
            This takes a minute or two. Stay here if you can. If you lose the
            page, choose the same clip again and we will pick it up from here.
          </p>
          {phase.resumes > 0 ? (
            <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
              The connection dropped {phase.resumes}{" "}
              {phase.resumes === 1 ? "time" : "times"} on the way up and picked
              up again. Nothing was lost.
            </p>
          ) : null}
        </div>
      ) : null}

      {phase.name === "failed" ? (
        <p role="alert" className="text-terra-deep mt-4 text-sm font-bold">
          {phase.message}
        </p>
      ) : null}
    </div>
  );
}
