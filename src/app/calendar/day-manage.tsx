"use client";

import { useState } from "react";
import { CLOSING_SENTENCE, alreadyConfirmedSentence } from "@/lib/day/calendar";
import { Button, ButtonLink } from "@/components/ui/button";
import { panelClass } from "@/components/ui/panel";
import { BlackoutForm } from "./blackout-form";

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
 * ## What is not here, said rather than left out
 *
 * - **Closing one start time.** `POST /blackouts` closes whole days. Setting a
 *   departure's seats to what is sold stops its sales without stranding
 *   anyone, so the panel points there.
 * - **Reopening.** No endpoint removes a closure, so no button pretends to.
 * - **Calling a departure off.** A heavier act — it cancels and refunds
 *   everyone on it — and it stays on the departure, behind its typed id.
 */
export function DayManage({
  day,
  label,
  guests,
  closed,
}: {
  day: string;
  label: string;
  guests: number | null;
  closed: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `manage-${day}`;

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
              won&apos;t move them — resolve each booking in Bookings.
            </p>
          ) : guests > 0 ? (
            <p className="text-terra-deep mt-2 text-sm font-bold">
              {alreadyConfirmedSentence(guests)}
            </p>
          ) : null}

          <ButtonLink href="/bookings" variant="outline" className="mt-4">
            Open Bookings
          </ButtonLink>

          <p className="text-forest/70 mt-4 text-sm">
            To stop selling one departure only, set its seats to what is already
            sold — it is in the list below. Calling a departure off is a heavier
            act: it cancels it and refunds everyone on it, and it is done from
            the departure itself.
          </p>

          <div className="mt-5">
            <BlackoutForm today={day} day={{ date: day, label, closed }} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
