"use client";

import { useLinkStatus } from "next/link";
import { cn } from "@/lib/cn";
import { ChevronRightIcon } from "./icons";

/**
 * A tap on a link, answered while the screen it opens is on its way (the
 * stability audit, P2-1).
 *
 * The detail screens (a booking, a departure, its boarding, a listing and
 * its builder, a payout, a statement, a member's notifications) have no
 * loading boundary on purpose: each can answer 404, and a boundary would
 * stream that 404 as a 200 (`loading.test.ts`). So nothing is painted
 * between the tap and the screen, Next prefetches none of them, and on one
 * bar of signal a tap on the busiest rows in the portal looked ignored.
 *
 * Both of these draw the ring a busy button turns (O04, `BusyButton`) inside
 * the link while it waits, from `useLinkStatus`: held back 300ms, so a fast
 * answer never shows it, then turning until the screen is in. The link keeps
 * its colour, as the button does: a dimmed link reads as one that is switched
 * off, at the moment it should look most alive. Outside a link (a row whose
 * body is shared with a `tel:` anchor) the status is always idle, so they
 * draw nothing extra there.
 *
 * `loading.test.ts` holds every link into one of those screens to one of
 * these.
 */

/**
 * The chevron at the end of a row, which gives way to the ring in its own
 * place while the row's screen is on its way, so nothing in the row moves.
 */
export function RowChevron({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  return (
    <span className="relative inline-grid shrink-0 place-items-center">
      <ChevronRightIcon
        data-motion={pending ? "" : undefined}
        className={cn(className, pending && "motion-busy-hide")}
      />
      {pending ? (
        <span
          aria-hidden="true"
          data-motion=""
          className="motion-busy-ring absolute"
        />
      ) : null}
    </span>
  );
}

/**
 * The ring after a link's words, for a link that ends in words rather than a
 * chevron. It takes its room from the first frame of the wait, as the
 * button's does, so the link changes width once. In a link drawn as a button
 * (`button`) the button's own gap spaces it, exactly as it spaces a busy
 * button's ring; after words it brings its own space.
 */
export function LinkRing({ button = false }: { button?: boolean }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <span
      aria-hidden="true"
      data-motion=""
      className={cn("motion-busy-ring", !button && "ml-1.5 align-middle")}
    />
  ) : null;
}
