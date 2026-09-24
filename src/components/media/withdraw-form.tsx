"use client";

import { useActionState, useState } from "react";
import { withdrawMedia, type WithdrawState } from "./actions";
import { WITHDRAW_REASONS } from "@/lib/media/rights";
import { Button } from "@/components/ui/button";
import { choiceClass } from "@/components/ui/input";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";

/**
 * Taking a clip down, from the library rather than only from the receipt.
 *
 * `POST /media/{id}/withdraw` has existed since O8 and could only be reached
 * for the clip just uploaded, while the submission panel was still on screen —
 * the wrong file noticed immediately, which is the case that actually happens
 * but is not the endpoint yuvoy-operator#9 describes. `GET /media` is what
 * closes that: there is now a list to find a clip in.
 *
 * ## Why a reason is asked for and not optional
 *
 * The set is closed in the contract, and two of the four are not about the
 * video at all: somebody in it objected, or the rights lapsed. Those are the
 * ones Yuvoy has to act on beyond taking the file down, and a free-text box —
 * or no question — would lose them.
 *
 * ## What a success here means, and what it does not
 *
 * "Two acts that fail independently, and only the first is transactional: it
 * comes off Yuvoy immediately, and the original is deleted at the video
 * provider shortly afterwards by a job." So the copy claims the half that has
 * happened and not the half that has not.
 *
 * ## Quiet until it is asked for (yuvoy-operator#81 t5)
 *
 * Taking a clip down empties the card a traveller is looking at, so the way
 * in is quiet text in the warning colour, like every other act that ends
 * something, and the loud button is the one inside the confirm. It was a
 * secondary pill, the same shape as the actions beside it (the audit, O14).
 */
export function WithdrawForm({
  mediaAssetId,
  attachedTo,
}: {
  mediaAssetId: string;
  /** The listing it is on, if any — what taking it down actually costs. */
  attachedTo?: string;
}) {
  const [state, act, pending] = useActionState<WithdrawState, FormData>(
    withdrawMedia,
    {},
  );
  const [open, setOpen] = useState(false);
  const { trigger, question } = useConfirmFocus(open);

  if (state.withdrawn) {
    return (
      <p
        role="status"
        className="border-paper-line text-forest/80 mt-4 border-t pt-3 text-sm font-bold"
      >
        {state.withdrawn.note ??
          "It is off Yuvoy. The original is deleted at the video provider shortly afterwards."}
      </p>
    );
  }

  if (!open) {
    return (
      <div className="mt-4">
        <Button
          ref={trigger}
          onClick={() => setOpen(true)}
          variant="danger-quiet"
          size="md"
          block={false}
          aria-expanded={false}
        >
          Take it down
        </Button>
      </div>
    );
  }

  return (
    <form action={act} className="border-paper-line mt-4 border-t pt-4">
      <input type="hidden" name="mediaAssetId" value={mediaAssetId} />

      <fieldset>
        <legend
          ref={question}
          tabIndex={-1}
          className="text-sm font-bold outline-none"
        >
          Why is it coming down?
        </legend>
        {/*
          Named before the reasons, because it is the consequence rather than
          the question: a clip on a listing is the thing travellers are
          looking at, and taking it down empties that card.
        */}
        {attachedTo ? (
          <p className="text-forest/80 mt-1.5 text-sm">
            It is on {attachedTo}. That listing loses this video.
          </p>
        ) : null}

        <div className="mt-3 space-y-2">
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
                <span className="block text-sm font-bold">{reason.label}</span>
                <span className="text-forest/80 block text-xs">
                  {reason.detail}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

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
          onClick={() => setOpen(false)}
          disabled={pending}
          variant="secondary"
          block={false}
          className="flex-1"
        >
          Not now
        </Button>
      </div>
    </form>
  );
}
