"use client";

import { useActionState, useState } from "react";
import { discardDraft, type DiscardState } from "./actions";
import { Button } from "@/components/ui/button";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";
import { useStillConfirm } from "@/components/ui/use-still-confirm";
import { sendForm } from "@/lib/actions/send-form";

/**
 * "Discard this draft" on a draft nobody has seen (yuvoy-operator#112).
 *
 * The page draws it only for a draft that has never been sent to us
 * (`isUnsentDraft`), to an owner, admin or manager, while the business may
 * still write: everything past that is a `409` or a `403`, and a control drawn
 * over a refusal is the one this portal does not draw.
 *
 * ## Quiet until it is asked for
 *
 * Like every act here that ends something (yuvoy-operator#81), the way in is
 * quiet text in the warning colour, and the loud button is the one inside the
 * confirm, which names the listing and says what goes with it. Focus moves to
 * the question and comes back to the trigger on "Keep it"
 * (`useConfirmFocus`). It arrives still and leaves the same way (O06 B,
 * `useStillConfirm`): the question fades in where the words were, and Keep
 * it fades a held copy of it out as they come back.
 *
 * ## No receipt here
 *
 * A discard that worked navigates to Business, where the listings re-read
 * without its tile; that is the receipt. A refusal stays in the confirm, under
 * the question it answers, with the draft still on the screen behind it.
 */
export function DiscardDraft({
  experienceId,
  title,
}: {
  experienceId: string;
  /** What the operator called it, named in the question. */
  title?: string;
}) {
  const [state, act, pending] = useActionState(
    sendForm<DiscardState>(discardDraft, () => ({
      message: "No signal. The draft is still here. Try again.",
    })),
    {},
  );
  const [open, setOpen] = useState(false);
  const { trigger, question } = useConfirmFocus(open);
  const { root, frame } = useStillConfirm(open ? "confirm" : "text");
  const name = title?.trim();

  if (!open) {
    return frame(
      <div ref={root} className="mt-6">
        <Button
          ref={trigger}
          variant="danger-quiet"
          size="md"
          block={false}
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          Discard this draft
        </Button>
      </div>,
    );
  }

  return frame(
    <form
      ref={root}
      action={act}
      className="border-paper-line mt-6 border-t pt-4"
    >
      <input type="hidden" name="experienceId" value={experienceId} />

      <p
        ref={question}
        tabIndex={-1}
        className="text-base font-bold text-balance outline-none"
      >
        {name ? <>Discard &ldquo;{name}&rdquo;?</> : "Discard this draft?"}
      </p>
      {/*
        What goes with it, because the Schedule step can save onto a draft:
        its departures go too (yuvoy-api#249). Nobody else holds anything on a
        draft, so that is all of it.
      */}
      <p className="text-forest/80 leading-body mt-1.5 text-sm text-pretty">
        It is deleted, with any departures saved on it. This cannot be undone.
      </p>

      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          variant="danger"
          block={false}
          className="flex-1"
          pending={pending}
          pendingLabel="Discarding"
        >
          Discard the draft
        </Button>
        <Button
          variant="secondary"
          block={false}
          className="flex-1"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Keep it
        </Button>
      </div>
    </form>,
  );
}
