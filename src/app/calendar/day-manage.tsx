"use client";

import { useCallback, useState } from "react";
import { CLOSING_SENTENCE, alreadyConfirmedSentence } from "@/lib/day/calendar";
import { closureLine, type Closure } from "@/lib/day/closures";
import { marketTime } from "@/lib/format/market-time";
import type { OperatorSlot } from "@/lib/day/types";
import { Button, ButtonLink } from "@/components/ui/button";
import { panelClass } from "@/components/ui/panel";
import { BlackoutForm } from "./blackout-form";
import { ReopenClosure } from "./reopen-closure";
import { CloseDeparture } from "./close-departure";

/** One thing the day's panel just did, said after the day re-reads. */
interface DayReceipt {
  key: string;
  title: string;
  note: string;
}

/**
 * Manage one day — yuvoy-operator#45. "Manage expands closure controls in
 * place — not a separate screen."
 *
 * ## The two sentences come before the button, verbatim
 *
 * "Please render both verbatim. An operator who closes a day believing it
 * cancelled the bookings does not turn up, and the people who paid are
 * standing on a jetty. This is the single most expensive misunderstanding
 * available in the portal, and the demo's copy is the fix."
 *
 * The count in the second one comes from `GET /bookings`, which stops at 100
 * rows. When the list may have been cut short the sentence is said without a
 * number rather than with a smaller one — see `confirmedGuestsByDay`.
 *
 * ## What is here now, and was not
 *
 * - **Reopening**, one button per closure in force that touches the day. There
 *   was no endpoint for it, and now there is: `POST /blackouts/{id}/reopen`
 *   "puts back on sale what this closure took off, and nothing else."
 * - **Stop selling one departure.** `POST /slots/{id}/close`. The panel used to
 *   tell an operator to set that departure's seats to what was sold, which
 *   worked and read as a trick: it also made the departure look full to
 *   anybody reading the row afterwards.
 *
 * ## What is still not here
 *
 * **Calling a departure off.** A heavier act — it cancels and refunds everyone
 * on it — and it stays on the departure, behind its typed id. Moving a
 * departure's time and the weekly schedule are on the listing hub (#56).
 */
export function DayManage({
  day,
  label,
  guests,
  closed,
  closures,
  departures,
}: {
  day: string;
  label: string;
  guests: number | null;
  closed: boolean;
  /**
   * Closures in force touching this day, widest first: the whole day, then one
   * listing, then one departure.
   *
   * Widest first because reopening the narrowest while the widest still holds
   * changes nothing an operator can see, and a list in the other order invites
   * exactly that. The API says so in its own answer: `departuresStillClosed` is
   * "departures still to come that stay closed, because another closure in
   * force also holds them."
   */
  closures: readonly Closure[];
  /** The day's departures, so each can be stopped on its own. */
  departures: readonly OperatorSlot[];
}) {
  const [open, setOpen] = useState(false);
  const panelId = `manage-${day}`;
  /*
    What reopening a closure, or stopping one departure, just did. Kept HERE
    because this panel survives the calendar re-reading and the row that did
    the work does not: a reopened closure leaves "Already closed", and a
    stopped departure leaves "Stop selling one departure" (op#89 f16). Cleared
    by a real navigation, by which time the day itself is the truth.
  */
  const [receipts, setReceipts] = useState<DayReceipt[]>([]);
  const onDone = useCallback((receipt: DayReceipt) => {
    setReceipts((prev) =>
      prev.some((r) => r.key === receipt.key) ? prev : [...prev, receipt],
    );
  }, []);

  return (
    <div className="mt-3">
      <Button
        variant="secondary"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
      >
        Manage
        {/* Fourteen buttons say "Manage"; a screen reader hears which day. */}
        <span className="sr-only"> {label}</span>
      </Button>

      {open ? (
        <div id={panelId} className={panelClass("raised", "mt-3")}>
          <p className="text-base font-bold">{CLOSING_SENTENCE}</p>
          {guests === null ? (
            <p className="text-terra-deep mt-2 text-sm font-bold">
              Anybody already confirmed on this day stays booked. Closing
              won&apos;t move them. Resolve each booking in Bookings.
            </p>
          ) : guests > 0 ? (
            <p className="text-terra-deep mt-2 text-sm font-bold">
              {alreadyConfirmedSentence(guests)}
            </p>
          ) : null}

          <ButtonLink href="/bookings" variant="outline" className="mt-4">
            Open Bookings
          </ButtonLink>

          {/*
            What reopening did, in the API's words: "it gives both counts in
            words", and it is the only place that says which departures went
            back on sale and which another closure still holds.
          */}
          {receipts.length > 0 ? (
            <div role="status" className="border-paper-line mt-5 border-t pt-4">
              <h4 className="label text-forest/75">Just now</h4>
              <ul className="mt-2 space-y-3">
                {receipts.map((r) => (
                  <li key={r.key} className="text-sm">
                    <p className="font-bold">{r.title}</p>
                    <p className="text-forest/80 mt-1">{r.note}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/*
            What is already closed, and the way back. Above the form that closes
            more: somebody opening Manage on a day that says Closed is usually
            here to undo it, not to close it twice.
          */}
          {closures.length > 0 ? (
            <div className="border-paper-line mt-5 border-t pt-4">
              <h4 className="label text-forest/75">Already closed</h4>
              <ul className="mt-2 space-y-3">
                {closures.map((closure) => (
                  <li key={closure.id}>
                    <p className="text-sm font-bold">
                      {closure.departureId
                        ? "One departure"
                        : closure.experienceId
                          ? "One listing"
                          : "The whole day"}
                    </p>
                    <p className="text-forest/80 mt-1 text-sm">
                      {closureLine(closure)}
                    </p>
                    <ReopenClosure
                      id={closure.id}
                      onReopened={(id, note) =>
                        onDone({ key: `reopen-${id}`, title: "Reopened", note })
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="border-paper-line mt-5 border-t pt-4">
            <h4 className="label text-forest/75">Stop selling one departure</h4>
            {/*
              Replaces "set its seats to what is already sold", which worked and
              read as a trick: it also made the departure look full to whoever
              read the row next, and there was no way to tell that from a boat
              that genuinely sold out.
            */}
            <p className="text-forest/70 mt-2 text-sm">
              The bookings on it stay. Calling a departure off is the heavier
              act, and it is on the departure itself.
            </p>
            {departures.filter((s) => s.status === "open").length === 0 ? (
              <p className="text-forest/70 mt-3 text-sm">
                Nothing here is still selling.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {departures
                  .filter((s) => s.status === "open")
                  .map((slot) => (
                    <li key={slot.id}>
                      <CloseDeparture
                        slotId={slot.id}
                        title={slot.title}
                        time={marketTime(slot.startsAt, slot.timezone)}
                        onClosed={(title, note) =>
                          onDone({ key: `close-${slot.id}`, title, note })
                        }
                      />
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="border-paper-line mt-5 border-t pt-4">
            <h4 className="label text-forest/75">Close the whole day</h4>
            <div className="mt-3">
              <BlackoutForm today={day} day={{ date: day, label, closed }} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
