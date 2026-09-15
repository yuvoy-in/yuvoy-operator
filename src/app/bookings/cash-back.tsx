"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import {
  recordCashReturned,
  type CashBackState,
} from "@/app/bookings/cancel-actions";
import { formatPaise } from "@/lib/format/money";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * "I gave the cash back" — yuvoy-operator#43 item 5.
 *
 * Only on a cancelled booking whose cash the business recorded taking. We
 * refunded nothing, because nothing reached us: "that money never reached us,
 * so it is yours to give back." This records that they did.
 *
 * ## Two taps, because one cannot be taken back
 *
 * "It cannot be undone, and it is recorded once: a retry answers `409
 * cash_already_returned` and changes nothing." A single tap on a 56px target
 * with wet hands would write a record saying a traveller was handed money they
 * were not, and nothing in the portal could correct it.
 */
export function CashBack({
  bookingId,
  amountPaise,
}: {
  bookingId: string;
  /** What was recorded as taken, which is all of what goes back. */
  amountPaise: number | null;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, act, pending] = useActionState<CashBackState, FormData>(
    recordCashReturned,
    {},
  );
  const router = useRouter();

  if (state.done || state.alreadyReturned) {
    return (
      <Panel tone="done" role="status" className="mt-4 p-4">
        <p className="text-base font-bold">
          {state.done
            ? `${formatPaise(state.done.returnedPaise)} recorded as given back`
            : "This was already recorded"}
        </p>
        <div className="mt-3">
          <Button
            variant="secondary"
            block={false}
            onClick={() => router.refresh()}
          >
            Show the booking
          </Button>
        </div>
      </Panel>
    );
  }

  if (!confirming) {
    return (
      <div className="mt-4">
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          I gave the cash back
        </Button>
        {state.message ? (
          <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
            {state.message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form action={act} className="mt-4">
      <input type="hidden" name="bookingId" value={bookingId} />
      <p className="text-sm font-bold">
        {amountPaise === null
          ? "Record that you gave this cash back?"
          : `Record that you gave ${formatPaise(amountPaise)} back?`}
      </p>
      <p className="text-forest/80 mt-1.5 text-sm">
        This cannot be undone. Record it once you have actually handed the money
        over, not before.
      </p>
      {state.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {state.message}
        </p>
      ) : null}
      <div className="mt-4 flex gap-2">
        <Button
          type="submit"
          block={false}
          className="flex-1"
          disabled={pending}
        >
          {pending ? "Recording…" : "Yes, I gave it back"}
        </Button>
        <Button
          variant="secondary"
          block={false}
          className="flex-1"
          disabled={pending}
          onClick={() => setConfirming(false)}
        >
          Not yet
        </Button>
      </div>
    </form>
  );
}
