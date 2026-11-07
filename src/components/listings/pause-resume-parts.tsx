"use client";

/** The resume half of `PauseResume`, moved out of pause-resume.tsx (yuvoy-operator#178). */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConfirmFocus } from "@/components/ui/use-confirm-focus";
import { useStillConfirm } from "@/components/ui/use-still-confirm";
import { Panel } from "@/components/ui/panel";

/**
 * Resume, armed by one tap and sent by a second.
 *
 * Lighter than a pause, with no reason to give, because it is not
 * destructive: pausing again is one form away. But it puts a listing in front of travellers straight away,
 * and a mis-tap on a wet phone should not open bookings for a boat that is
 * out of the water, so the second tap says what the first one will do.
 */
export function ResumeControl({
  experienceId,
  title,
  action,
  pending,
  message,
}: {
  experienceId: string;
  title: string;
  action: (form: FormData) => void;
  pending: boolean;
  message?: string;
}) {
  const [armed, setArmed] = useState(false);
  const { trigger, question } = useConfirmFocus(armed);
  const { root, frame } = useStillConfirm(armed ? "confirm" : "text");

  if (!armed) {
    return frame(
      <div ref={root} className="mt-4">
        <Button
          ref={trigger}
          onClick={() => setArmed(true)}
          variant="secondary"
          aria-expanded={false}
        >
          Resume
        </Button>
        {message ? (
          <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
            {message}
          </p>
        ) : null}
      </div>,
    );
  }

  return frame(
    <form
      ref={root}
      action={action}
      className="border-paper-line mt-4 border-t pt-4"
    >
      <input type="hidden" name="id" value={experienceId} />
      <p
        ref={question}
        tabIndex={-1}
        className="text-sm font-bold text-balance outline-none"
      >
        Put {title} back on sale?
      </p>
      <p className="text-forest/80 leading-body mt-1.5 text-sm text-pretty">
        It goes back on sale as soon as you do. There is no review to wait for.
      </p>
      {message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {message}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          pending={pending}
          pendingLabel="Resuming"
          block={false}
          className="flex-1"
        >
          Yes, resume it
        </Button>
        <Button
          onClick={() => setArmed(false)}
          disabled={pending}
          variant="secondary"
          block={false}
          className="flex-1"
        >
          Not yet
        </Button>
      </div>
    </form>,
  );
}

/**
 * What resuming did — and, for a listing still awaiting its first approval,
 * what it could not do.
 */
/**
 * What resuming did, in the API's own words — yuvoy-operator#44.
 *
 * `next` was suppressed here, and for a real reason: it claimed "Travellers
 * can see it and book it now" unconditionally, which is false for a listing
 * resumed while the account or its documents stop sales. yuvoy-api#167 made
 * the sentence conditional on what is actually true — back on sale; back on
 * the listings but not bookable while something on the account stops sales;
 * or, for a listing never approved, still waiting for its first check — so it
 * is printed verbatim again.
 *
 * The server chooses the sentence better than this screen can. It reads the
 * account's standing and the listing back; this component knows only the
 * state.
 *
 * Both fallbacks stay for an answer that carries no `next`: an older
 * deployment, or a field the API stops sending. Neither claims more than the
 * state supports.
 */
export function Resumed({
  state,
  next,
  root,
}: {
  state: "published" | "in_review";
  next?: string;
  /** The panel's own element, for the fade it arrives with. */
  root?: (element: HTMLElement | null) => void;
}) {
  if (state === "in_review") {
    return (
      <Panel ref={root} className="mt-4" role="status">
        <p className="text-base font-bold text-balance">
          Still waiting for its first approval
        </p>
        <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
          {next ??
            "Resuming cannot skip a review that has not happened yet. It goes on sale when we approve it."}
        </p>
      </Panel>
    );
  }
  return (
    <Panel ref={root} tone="done" className="mt-4" role="status">
      <p className="text-base font-bold text-balance">Resumed</p>
      <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
        {next ??
          "It is back on sale. If anything on your account stops sales, the label on this listing says so. Resuming does not change that."}
      </p>
    </Panel>
  );
}
