"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { CLOSING_SENTENCE, alreadyConfirmedSentence } from "@/lib/day/calendar";
import { closureLine, type Closure } from "@/lib/day/closures";
import { Button } from "@/components/ui/button";
import { BlackoutForm } from "./blackout-form";
import { ReopenClosure } from "./reopen-closure";

/** One thing the day's panel just did, said after the day re-reads. */
interface DayReceipt {
  key: string;
  title: string;
  note: string;
}

/**
 * What a manager can do to a whole day, at the foot of the opened day:
 * reopen what is closed, or close it (yuvoy-operator#45, laid out by #84 s7).
 *
 * The day itself is the disclosure now, so the "Manage" button that used to
 * open this is gone: opening the day is the tap. Stopping one departure moved
 * into that departure's own row.
 *
 * ## The two sentences come before the button, verbatim
 *
 * "Please render both verbatim. An operator who closes a day believing it
 * cancelled the bookings does not turn up, and the people who paid are
 * standing on a jetty." They are the confirm that "Close this day" opens,
 * because they are the consequence of the tap, and a consequence belongs
 * beside the button that causes it rather than above every day.
 *
 * The count in the second one comes from `GET /bookings`. When that read
 * failed the sentence is said without a number rather than with a smaller one
 * (see `confirmedGuestsByDay`).
 *
 * ## Quiet, and kept mounted
 *
 * "Close this day" is text in the warning colour (#81). Once somebody opens
 * the confirm it stays mounted even after the re-read turns the day Closed,
 * because the receipt a close produces ("You still owe 3 bookings") lives in
 * the form, and the revalidate would otherwise take it away the instant it
 * appeared.
 *
 * Reopening hands its note up HERE (`onReopened`): a reopened closure drops
 * out of the list and its row unmounts on the re-read, and this panel does
 * not (op#89 f16).
 */
export function DayPanel({
  day,
  label,
  guests,
  closed,
  closures,
}: {
  day: string;
  label: string;
  guests: number | null;
  /** A closure in force shuts the whole day. */
  closed: boolean;
  /**
   * Closures in force touching this day, widest first: the whole day, then one
   * listing, then one departure. Reopening the narrowest while the widest
   * still holds changes nothing an operator can see.
   */
  closures: readonly Closure[];
}) {
  const [closing, setClosing] = useState(false);
  const [receipts, setReceipts] = useState<DayReceipt[]>([]);
  const onDone = useCallback((receipt: DayReceipt) => {
    setReceipts((prev) =>
      prev.some((r) => r.key === receipt.key) ? prev : [...prev, receipt],
    );
  }, []);

  return (
    <div className="space-y-5">
      {/*
        What reopening did, in the API's words: "it gives both counts in
        words", and it is the only place that says which departures went back
        on sale and which another closure still holds.
      */}
      {receipts.length > 0 ? (
        <div role="status">
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
        What is already closed, and the way back. Above the control that closes
        more: somebody opening a day that says Closed is usually here to undo it.
      */}
      {closures.length > 0 ? (
        <div>
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
                  onReopened={(id, note) => {
                    onDone({ key: `reopen-${id}`, title: "Reopened", note });
                    /*
                      A close receipt still on screen now describes a day that
                      is open again, so it goes, and the day offers to close
                      again once the re-read says it can be.
                    */
                    setClosing(false);
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {closing ? (
        <BlackoutForm
          today={day}
          day={{ date: day, label, closed }}
          onCancel={() => setClosing(false)}
        >
          <p className="mt-2 text-sm font-bold">{CLOSING_SENTENCE}</p>
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
          <Link
            href="/bookings"
            className="text-forest decoration-forest/40 inline-flex min-h-11 items-center text-sm underline underline-offset-4"
          >
            Open Bookings
          </Link>
        </BlackoutForm>
      ) : closed ? null : (
        <div>
          <Button
            variant="danger-quiet"
            size="md"
            block={false}
            onClick={() => setClosing(true)}
          >
            {/*
              Fourteen days say "Close this day"; a screen reader hears which.
              The space sits outside the hidden part, so no name computation
              can join the two words together.
            */}
            Close this day <span className="sr-only">({label})</span>
          </Button>
        </div>
      )}
    </div>
  );
}
