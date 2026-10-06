"use client";

import { StandInScreen } from "@/components/chrome/stand-in-screen";
import { useHeldLinks } from "@/components/chrome/read-only-when-offline";
import { useRetry } from "@/components/chrome/use-retry";
import { Button, ButtonLink } from "@/components/ui/button";
import { useOnline } from "@/components/ui/use-online";

/**
 * What a screen says when it could not load.
 *
 * **This file did not exist until O3, and its absence was a live defect.**
 * `requireOperator()` documented itself as throwing "to the error boundary,
 * which says what is actually true": into nothing. Every failure this portal
 * could not handle rendered Next's default page, on a jetty, at 0.5 Mbps,
 * where the connection dropping is the common path rather than the exception.
 *
 * ## Why it does not say what went wrong
 *
 * It cannot. In production Next replaces a thrown error's message with a
 * generic one before a boundary ever sees it, leaving only an opaque `digest`.
 * So a boundary that branched on the error would be branching on nothing,
 * which is why `account_not_active` is now handled where it is *known*, in
 * `requireOperator()`, rather than being thrown here in the hope that this
 * file could work it out.
 *
 * What is left is one honest sentence, the retry that is usually the answer,
 * and a way back. The `digest` stays off the screen and in the server logs,
 * following the rule the rest of the portal already keeps: "a correlation id
 * is for a support conversation that happens later: it goes to the logs, not
 * into sunlight."
 *
 * ## It wears the chassis of the screen it replaced
 *
 * It drew a signed-out door's on every route, so on a tab root the strip lost
 * the business and the inbox, and the bar, which stays there, covered the
 * foot of a sheet that left it no room (the stability audit, P3-6). It reads
 * the route from the address instead (`StandInScreen`).
 *
 * ## Try again asks the server again
 *
 * It called `reset()`, which never asks the server, so a page whose server
 * render had failed failed again at once. It reads the page again now, and
 * with no signal keeps the tap until the signal is back (`useRetry`). Back
 * to today is held the way a read-only screen holds its links
 * (`useHeldLinks`), since following it with no signal would be the
 * browser's own "no internet" page.
 */
export default function Error({ retry }: { retry: () => void }) {
  const { held, onClickCapture } = useHeldLinks(useOnline());
  const { tryAgain, retrying, waiting } = useRetry(retry);

  return (
    <StandInScreen width="sm">
      <div onClickCapture={onClickCapture}>
        <h1 className="font-display tracking-display leading-display text-4xl text-balance">
          That did not load
        </h1>
        <Button
          onClick={tryAgain}
          pending={retrying}
          pendingLabel="Trying again"
          className="mt-8"
        >
          Try again
        </Button>

        <ButtonLink href="/today" variant="secondary" className="mt-3">
          Back to today
        </ButtonLink>

        {/* Mounted from the start, so a screen reader hears it arrive. */}
        <p
          role="status"
          className={
            held || waiting
              ? "text-terra-deep leading-body mt-4 text-sm font-bold text-pretty"
              : "sr-only"
          }
        >
          {held
            ? "No signal. That opens once you are back online."
            : waiting
              ? "No signal. It tries again once you are back online."
              : null}
        </p>
      </div>

      {/*
        The one thing a retry screen owes somebody who was mid-action. A
        relay that reached eleven people twice is not a cosmetic failure, and
        this portal cannot tell them from here whether the tap landed.
      */}
      <p className="border-paper-line text-forest/70 leading-body mt-10 border-t pt-6 text-sm text-pretty">
        If you had just tapped something (accepted a request, sent a message,
        marked somebody off), check whether it took effect before doing it
        again.
      </p>
    </StandInScreen>
  );
}
