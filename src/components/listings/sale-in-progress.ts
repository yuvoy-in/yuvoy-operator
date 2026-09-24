import { deadlineLabel } from "@/lib/format/market-time";
import { sentence } from "@/lib/format/sentence";

/**
 * Why a listing cannot be paused right now, and when it can
 * (`409 sale_in_progress` on `POST /experiences/{id}/pause`).
 *
 * "Somebody holds unpaid seats on this listing, or a request on it is waiting
 * for your answer. A checkout hold lasts ten minutes, but an accepted request
 * holds for up to twelve hours, so the message says until when, and `details`
 * carries `heldUntil` (the last unpaid hold's end, absent when there is none)
 * and `openRequests` (how many requests to accept or decline first)."
 *
 * It used to say "try again in a few minutes" whatever the wait was, which is
 * false for a twelve-hour hold: an operator would try again, be refused again,
 * and conclude the button is broken. The time is written the way every
 * deadline in the portal is, in the market's clock, with the day when it is
 * not today, because a hold that ends at 08:00 tomorrow is not "08:00".
 *
 * Both details are read as optional. With neither, the API's own sentence is
 * said, which also says until when; with no sentence either, the old one.
 */
export function saleInProgressMessage(
  details: unknown,
  apiMessage: string,
  nowMs: number,
): string {
  const d =
    details && typeof details === "object"
      ? (details as { heldUntil?: unknown; openRequests?: unknown })
      : {};
  const until =
    typeof d.heldUntil === "string"
      ? deadlineLabel(d.heldUntil, "Asia/Kolkata", nowMs)
      : "";
  const requests =
    Number.isInteger(d.openRequests) && (d.openRequests as number) > 0
      ? (d.openRequests as number)
      : 0;
  const waiting =
    requests === 1
      ? "1 request on it is waiting for your answer"
      : `${requests} requests on it are waiting for your answer`;

  if (until && requests > 0) {
    return `Somebody holds unpaid seats on this listing until ${until}, and ${waiting}. Answer them, then pause it after ${until}. Nothing changed.`;
  }
  if (until) {
    return `Somebody holds unpaid seats on this listing until ${until}. You can pause it after that. Nothing changed.`;
  }
  if (requests > 0) {
    return `${requests === 1 ? "1 request on this listing is" : `${requests} requests on this listing are`} waiting for your answer. Accept or decline ${requests === 1 ? "it" : "them"} first. Nothing changed.`;
  }
  return (
    sentence(apiMessage) ||
    "Somebody is paying for this listing right now. Try again in a few minutes. Nothing changed."
  );
}
