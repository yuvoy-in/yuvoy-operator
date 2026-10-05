"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckIcon } from "@/components/ui/icons";

/**
 * A copy control for one value on a statement: the UPI ID, or the reference.
 *
 * Somebody paying from another phone, or from a UPI app that will not open
 * from a link, types both by hand, and a UPI ID mistyped by one letter is a
 * payment to a stranger. The value itself stays on screen as selectable text
 * beside this, so a failed copy costs nothing.
 *
 * Three states, as the join link's (`team/join-link.tsx`): "Copied" that never
 * goes away looks broken the second time, and a failure has to say so, since
 * `navigator.clipboard` is absent on a non-secure origin and throws when the
 * document is not focused.
 */
export function CopyValue({
  value,
  what,
}: {
  value: string;
  /** What is copied, for the control's name: "the UPI ID". */
  what: string;
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
      await navigator.clipboard.writeText(value);
      setState("copied");
      timer.current = window.setTimeout(() => setState("idle"), 4000);
    } catch {
      setState("failed");
    }
  };

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        onClick={copy}
        variant="secondary"
        size="sm"
        block={false}
        aria-label={state === "copied" ? `Copied ${what}` : `Copy ${what}`}
      >
        {state === "copied" ? (
          <>
            <CheckIcon className="size-3.5" />
            Copied
          </>
        ) : (
          "Copy"
        )}
      </Button>
      {/* Said aloud as well as shown: the button's new name is not announced. */}
      <span role="status" className="sr-only">
        {state === "copied" ? `Copied ${what}` : ""}
      </span>
      {state === "failed" ? (
        <span role="alert" className="text-forest/80 text-right text-xs">
          Could not copy it here. Select it and copy it by hand.
        </span>
      ) : null}
    </span>
  );
}
