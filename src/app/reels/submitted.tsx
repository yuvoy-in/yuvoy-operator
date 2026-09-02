"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { withdrawMedia, type WithdrawState } from "./actions";
import { WITHDRAW_REASONS } from "@/lib/media/rights";

/**
 * What the operator sees once the rights are recorded — and the one thing
 * they can still do about it.
 *
 * **Attesting is not publishing**, which is the sentence that stops the phone
 * call: somebody who thinks this published their clip goes looking for it in
 * the feed tomorrow and finds nothing.
 *
 * The takedown is here rather than on a list because there is no list.
 * `GET /media` does not exist, so this id is unrecoverable the moment the page
 * unmounts — but the case that actually happens is the wrong file, noticed
 * immediately, and that case is covered. The limitation is stated rather than
 * left to be discovered.
 */
export function Submitted({
  mediaAssetId,
  /*
    Named for what it is. It was `note`, and the withdrawn branch below then
    rendered it too — so taking a clip down said "a person at Yuvoy checks this
    before the clip can appear anywhere", which is not merely wrong, it
    reassures about the opposite of what just happened. An operator who
    withdrew a clip because somebody objected would read that it is still on
    its way to review.

    Two different notes from two different endpoints. They do not share a name.
  */
  attestationNote,
}: {
  mediaAssetId: string;
  attestationNote?: string;
}) {
  const [state, act, pending] = useActionState<WithdrawState, FormData>(
    withdrawMedia,
    {},
  );
  const [confirming, setConfirming] = useState(false);

  if (state.withdrawn) {
    return (
      <div className="rounded-edge border-cream-line bg-cream-deep border p-5">
        <p className="text-base font-bold">Taken down</p>
        {/*
          "Two acts that fail independently, and only the first is
          transactional: it comes off Yuvoy immediately, and the original is
          deleted at the video provider shortly afterwards by a job."

          So this says what is true NOW — it is off Yuvoy — and does not
          promise a provider deletion that has not happened yet. Conflating
          them is how an operator who asked because somebody objected is told
          the footage is gone when it is not, yet.
        */}
        <p className="text-forest/80 mt-2 text-sm">
          {state.withdrawn.note ??
            "It is off Yuvoy. The original is deleted at the video provider shortly afterwards."}
        </p>
        <Link
          href="/reels"
          className="rounded-edge dock-target label border-cream-line bg-cream text-forest mt-4 flex items-center justify-center border px-5"
        >
          Add another
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-edge border-forest bg-forest/5 border-2 p-5">
      <p className="text-base font-bold">Recorded, and queued for review</p>
      <p className="text-forest/80 mt-2 text-sm">
        {attestationNote ??
          "A person at Yuvoy checks this before the clip can appear anywhere."}
      </p>
      <p className="text-forest/80 mt-2 text-sm">
        It is <strong>not published</strong>. Nothing you have uploaded is
        visible to travellers until that check is done.
      </p>

      {confirming ? (
        <form action={act} className="mt-5">
          <input type="hidden" name="mediaAssetId" value={mediaAssetId} />
          <fieldset>
            <legend className="label text-forest/75">
              Why is it coming down?
            </legend>
            {/*
              A closed set, and the counts are the point: "`people_in_it_objected`
              arriving repeatedly for one operator is a consent problem in how
              they film, not a series of unrelated takedowns." So the labels
              describe what happened rather than offering a quick way out of the
              dialog.
            */}
            <div className="mt-2 space-y-2">
              {WITHDRAW_REASONS.map((reason) => (
                <label
                  key={reason.code}
                  className="rounded-edge border-cream-line bg-cream flex cursor-pointer items-start gap-3 border p-3"
                >
                  <input
                    type="radio"
                    name="reason"
                    value={reason.code}
                    required
                    className="mt-0.5 size-5 shrink-0"
                  />
                  <span>
                    <span className="block text-sm font-bold">
                      {reason.label}
                    </span>
                    <span className="text-forest/80 block text-xs">
                      {reason.detail}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-edge dock-target label border-terra-deep text-terra-deep flex-1 border-2 px-5 font-bold disabled:cursor-not-allowed disabled:opacity-55"
            >
              {pending ? "Taking it down…" : "Take it down"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-edge dock-target label border-cream-line bg-cream flex-1 border px-5"
            >
              Back
            </button>
          </div>
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-edge dock-target label border-cream-line bg-cream text-forest mt-5 w-full border px-5"
          >
            Wrong clip? Take it down
          </button>
          {/*
            The limitation, said here because here is where it bites. Once this
            page is gone the id is gone with it, and nothing in the portal can
            find the clip again.
          */}
          <p className="text-forest/70 mt-2 text-xs">
            Only while this page is open. There is no list of your clips yet, so
            after this you would have to message us.
          </p>
        </>
      )}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <Link
        href="/today"
        className="rounded-edge dock-target label border-cream-line bg-cream-deep text-forest mt-4 flex items-center justify-center border px-5"
      >
        Back to today
      </Link>
    </div>
  );
}
