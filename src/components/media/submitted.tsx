"use client";

import { useActionState, useState } from "react";
import { withdrawMedia, type WithdrawState } from "./actions";
import { WITHDRAW_REASONS } from "@/lib/media/rights";
import { Button, ButtonLink } from "@/components/ui/button";
import { choiceClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * What the operator sees once the rights are recorded — and the one thing
 * they can still do about it.
 *
 * **Attesting is not publishing**, which is the sentence that stops the phone
 * call: somebody who thinks this published their clip goes looking for it in
 * the feed tomorrow and finds nothing.
 *
 * The takedown stays here for the common case: the wrong file, noticed
 * immediately. The reel library also keeps the clip visible after this page.
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
      <Panel>
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
        <ButtonLink
          href="/account?tab=reels"
          variant="secondary"
          className="mt-4"
        >
          Add another
        </ButtonLink>
      </Panel>
    );
  }

  return (
    <Panel tone="done">
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
                  className={choiceClass(false, "items-start py-4")}
                >
                  <input
                    type="radio"
                    name="reason"
                    value={reason.code}
                    required
                    className="accent-terra-deep mt-0.5 size-5 shrink-0"
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
            <Button
              type="submit"
              disabled={pending}
              variant="danger"
              block={false}
              className="flex-1"
            >
              {pending ? "Taking it down…" : "Take it down"}
            </Button>
            <Button
              onClick={() => setConfirming(false)}
              disabled={pending}
              variant="secondary"
              block={false}
              className="flex-1"
            >
              Back
            </Button>
          </div>
        </form>
      ) : (
        <>
          <Button
            onClick={() => setConfirming(true)}
            variant="secondary"
            className="mt-5"
          >
            Wrong clip? Take it down
          </Button>
          <p className="text-forest/70 mt-2 text-xs">
            It will also appear in your reel list after this receipt.
          </p>
        </>
      )}

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <ButtonLink href="/today" variant="secondary" className="mt-4">
        Back to today
      </ButtonLink>
    </Panel>
  );
}
