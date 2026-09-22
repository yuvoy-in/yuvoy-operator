import type { ReviewNote } from "@/lib/account/review";
import { Panel } from "@/components/ui/panel";

/**
 * A logo or details change that is waiting on Yuvoy, or was refused
 * (yuvoy-operator#89 f10).
 *
 * The receipt after sending one says it once. This is what the screen says on
 * every visit after that, read from `GET /change-requests` (see
 * `src/lib/account/review.ts`), because the screen otherwise shows the old
 * value and nothing else, and "did they get it?" is then only answered by
 * sending it again.
 *
 * Presentational, no hooks: the logo page renders it on the server and the
 * details form on the client, from the same pre-formatted note.
 */
export function ReviewPanel({
  note,
  subject,
  hasCurrent,
}: {
  note: ReviewNote;
  subject: "logo" | "details";
  /** Whether there is a value on file now: a logo, or details. */
  hasCurrent: boolean;
}) {
  const sent = note.sentOn ? `Sent on ${note.sentOn}. ` : "";

  if (note.state === "waiting") {
    return (
      <Panel tone="outline" role="status" className="p-4">
        <p className="text-sm font-bold">
          {subject === "logo"
            ? "A new logo is waiting for our check"
            : "A change to these details is waiting for our check"}
        </p>
        <p className="text-forest/80 mt-1 text-sm">
          {sent}
          {subject === "logo"
            ? hasCurrent
              ? "Your current one stays up until we have."
              : "It appears on your listings once we have."
            : "What you see here is what is on file until we have."}
        </p>
      </Panel>
    );
  }

  /*
    Refused. The row carries no reason, so this says what happened and where
    to go, never why: a reason we made up is worse than none.
  */
  return (
    <Panel tone="alert" role="status" className="p-4">
      <p className="text-sm font-bold">
        {subject === "logo"
          ? "We did not use the logo you sent"
          : "We did not apply the change you sent"}
      </p>
      <p className="text-forest/80 mt-1 text-sm">
        {sent}
        {subject === "logo"
          ? hasCurrent
            ? "Your current one is still up. You can send another."
            : "You can send another."
          : /*
              "Call", because a telephone number is the one way to reach us
              the portal offers (Settings, Help).
            */
            "What you see here is still what is on file. Call us if it still needs changing."}
      </p>
    </Panel>
  );
}
