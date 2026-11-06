"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRetry } from "@/components/chrome/use-retry";
import { Button } from "@/components/ui/button";

/**
 * "Try again" under a claim read that failed (yuvoy-operator#388): the
 * listing's preview on the claim page, or the claims list on Verification.
 * The read is the server's, so trying again reads the page again, and with
 * no signal the tap waits for the signal (`useRetry`), as the error screen's
 * does.
 */
export function ReadAgain() {
  const router = useRouter();
  const refresh = useCallback(() => {
    if (navigator.onLine) router.refresh();
  }, [router]);
  const { tryAgain, retrying, waiting } = useRetry(refresh);
  return (
    <>
      <Button
        onClick={tryAgain}
        variant="secondary"
        className="mt-4"
        pending={retrying}
        pendingLabel="Trying again"
      >
        Try again
      </Button>
      {/* Mounted from the start, so a screen reader hears it arrive. */}
      <p
        role="status"
        className={
          waiting
            ? "text-terra-deep leading-body mt-3 text-sm font-bold text-pretty"
            : "sr-only"
        }
      >
        {waiting ? "No signal. It tries again once you are back online." : ""}
      </p>
    </>
  );
}
