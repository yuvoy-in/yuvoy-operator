"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";
import { cn } from "@/lib/cn";
import { COPIED, COPY_CODE, COPY_FAILED } from "@/lib/claims/words";

/** How long "Copied" stays before the button reads "Copy code" again. */
export const COPIED_FOR_MS = 4000;

/**
 * A `public_page_code` claim's code (yuvoy-operator#388), large and
 * selectable, with "Copy code" under it: "Copied" with a tick for four
 * seconds, and a line when the browser would not copy. The phone's
 * `proof-code.tsx`, in the three states of `CopyValue`: `navigator.clipboard`
 * is absent on a non-secure origin and throws when the page is not focused,
 * and the code stays on screen, so a failed copy costs nothing.
 *
 * `small` sets it a step down, for the claims list on Verification.
 */
export function ProofCode({
  code,
  small = false,
}: {
  code: string;
  small?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  // A timer left running would set state on a screen already left.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const copy = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setState("copied");
      timer.current = window.setTimeout(() => setState("idle"), COPIED_FOR_MS);
    } catch {
      setState("failed");
    }
  };

  const copied = state === "copied";
  return (
    <div className="mt-3 flex flex-col items-start gap-3">
      <p
        className={cn(
          "tracking-ref font-bold break-all slashed-zero tabular-nums select-all",
          small ? "text-xl" : "text-3xl",
        )}
        data-testid="claim-proof-code"
      >
        {code}
      </p>
      <Button
        onClick={copy}
        variant="secondary"
        size="sm"
        block={false}
        aria-label={copied ? `${COPIED} ${code}` : `${COPY_CODE} ${code}`}
      >
        {copied ? (
          <>
            <CheckIcon className="size-3.5" />
            {COPIED}
          </>
        ) : (
          COPY_CODE
        )}
      </Button>
      {/* Said aloud as well as shown: the button's new name is not announced. */}
      <span role="status" className="sr-only">
        {copied ? `${COPIED} ${code}` : ""}
      </span>
      {state === "failed" ? (
        <p role="alert" className="text-forest/80 text-sm">
          {COPY_FAILED}
        </p>
      ) : null}
    </div>
  );
}
