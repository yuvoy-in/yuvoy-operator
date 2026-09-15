"use client";

import { useActionState, useState } from "react";
import {
  recordCashCollected,
  type CashState,
} from "@/app/bookings/cash-actions";
import { describeCash, type BookingCash } from "@/lib/money/bookings";
import {
  canRecordAmount,
  compareToFare,
  fareComparisonText,
  rupeesToPaise,
} from "@/lib/money/cash";
import { formatPaise } from "@/lib/format/money";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CoinsIcon } from "@/components/ui/icons";
import { inputClass } from "@/components/ui/input";

/** The states the API will take money in. Anything else answers 409. */
const TAKES_CASH = new Set(["paid_pending_ops", "confirmed"]);

/**
 * The cash on one booking, and the tap that records it — yuvoy-operator#40 §1.
 *
 * On the manifest beside the attendance buttons, and on the booking's own
 * page. Never merged with arriving: "a jetty where those are one tap is a
 * jetty where nobody can say afterwards which happened".
 *
 * ## What it shows, in order of what is true
 *
 *   1. **Recorded** — by this tap, by a retry, or before this page loaded —
 *      reads plainly, `₹10,000 taken · 09:04`, with nothing to tap into a
 *      different number. A retry's answer renders exactly like this: "show
 *      the recorded state, not an error and not a second confirmation."
 *   2. **Owed, and the booking can still take it** — the fare, one tap for
 *      the whole of it, and "Took less" for the rest.
 *   3. **Completed without being recorded** — said, with no button: the API
 *      takes money only from a `paid_pending_ops` or `confirmed` booking, so
 *      a button here would be a 409.
 *   4. **Cancelled, declined, no-show** — nothing. A no-show who never paid
 *      them owes nobody anything.
 *
 * ## Took less
 *
 * A collection is recorded once and never overwritten, so the gap is said
 * while the box is still open — from the fare this row already holds — and
 * more than the fare is refused before it is sent, because the API refuses it
 * outright rather than trimming it. The shortfall the answer carries is then
 * said once, quietly, and is not treated as an error.
 */
export function CashCollect({
  bookingId,
  slotId,
  state,
  cash,
  timezone,
}: {
  bookingId: string;
  /** The departure this row sits on, so its manifest re-reads. Empty on a booking's own page. */
  slotId: string;
  /** The booking's fulfilment state, exactly as the API sent it. */
  state: string;
  cash: BookingCash;
  timezone: string;
}) {
  const [result, record, pending] = useActionState<CashState, FormData>(
    recordCashCollected,
    {},
  );
  const [less, setLess] = useState(false);
  const [typed, setTyped] = useState("");

  const recorded = result.recorded;
  if (recorded || cash.collected) {
    const shown: BookingCash = recorded
      ? {
          collectPaise: cash.collectPaise,
          collected: true,
          collectedAt: recorded.collectedAt,
          collectedPaise: recorded.collectedPaise,
        }
      : cash;
    return (
      <div className="border-paper-line mt-4 border-t pt-3">
        <p role="status" className="text-sm font-bold">
          {describeCash(shown, timezone)}
        </p>
        {recorded &&
        !recorded.alreadyRecorded &&
        recorded.shortfallPaise > 0 ? (
          <p className="text-forest/80 mt-1 text-sm">
            Recorded {formatPaise(recorded.collectedPaise)}. That is{" "}
            {formatPaise(recorded.shortfallPaise)} short of the fare.
          </p>
        ) : null}
      </div>
    );
  }

  const key = state.trim().toLowerCase();
  if (!TAKES_CASH.has(key)) {
    if (key !== "completed") return null;
    return (
      <div className="border-paper-line mt-4 border-t pt-3">
        <p className="text-sm font-bold">{describeCash(cash, timezone)}</p>
        <p className="text-forest/80 mt-1 text-sm">
          This trip was marked completed before the cash was recorded, and it
          can no longer be recorded here.
        </p>
      </div>
    );
  }

  const comparison = compareToFare(typed, cash.collectPaise);
  const amountId = `cash-${bookingId}`;

  return (
    <div className="border-paper-line mt-4 border-t pt-3">
      <p className="text-sm font-bold">{describeCash(cash, timezone)}</p>

      {less ? (
        /*
          Keyed on the attempt counter so the form REMOUNTS after a refusal and
          re-reads `typed`. React resets a form when its action completes, and
          an amount that vanished on "no signal" is an amount somebody retypes
          wrong.
        */
        <form key={result.attempt ?? 0} action={record} className="mt-3">
          <input type="hidden" name="bookingId" value={bookingId} />
          <input type="hidden" name="slotId" value={slotId} />
          <input type="hidden" name="mode" value="less" />

          <label htmlFor={amountId} className="label text-forest/75">
            What you took, in rupees
          </label>
          {/*
            `inputMode`, not `type="number"`: native number validation blocks
            the submit with a browser tooltip, and the sentence below is the
            refusal an operator actually needs to read.
          */}
          <input
            id={amountId}
            name="amount"
            inputMode="numeric"
            autoComplete="off"
            defaultValue={result.typed ?? ""}
            onChange={(event) => setTyped(event.target.value)}
            aria-describedby={`${amountId}-gap`}
            className={inputClass("bg-paper mt-2 text-lg")}
          />
          <p
            id={`${amountId}-gap`}
            aria-live="polite"
            className={cn(
              "mt-1.5 text-sm",
              comparison.kind === "more" || comparison.kind === "invalid"
                ? "text-terra-deep font-bold"
                : "text-forest/80",
            )}
          >
            {fareComparisonText(comparison)}
          </p>
          <p className="text-forest/70 mt-1 text-xs">
            Recorded once. It cannot be changed afterwards.
          </p>

          {result.message ? (
            <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
              {result.message}
            </p>
          ) : null}

          <div className="mt-3 flex gap-2">
            <Button
              type="submit"
              disabled={pending || !canRecordAmount(comparison)}
              block={false}
              className="flex-1"
            >
              {pending ? "Recording…" : recordLabel(typed)}
            </Button>
            <Button
              onClick={() => setLess(false)}
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
          <form action={record} className="mt-3 flex flex-wrap gap-2">
            <input type="hidden" name="bookingId" value={bookingId} />
            <input type="hidden" name="slotId" value={slotId} />
            <input type="hidden" name="mode" value="fare" />
            <Button
              type="submit"
              disabled={pending}
              variant="secondary"
              block={false}
              className="flex-1"
            >
              <CoinsIcon className="size-5" />
              {pending ? "Recording…" : "Cash taken"}
            </Button>
            <Button
              onClick={() => {
                setTyped(result.typed ?? "");
                setLess(true);
              }}
              disabled={pending}
              variant="outline"
              block={false}
              className="flex-1"
            >
              Took less
            </Button>
          </form>
          {result.message ? (
            <p role="alert" className="text-terra-deep mt-2 text-sm font-bold">
              {result.message}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** "Record ₹3,000" once the box holds an amount — the button repeats the number. */
function recordLabel(typed: string): string {
  const paise = rupeesToPaise(typed);
  return paise === null ? "Record it" : `Record ${formatPaise(paise)}`;
}
