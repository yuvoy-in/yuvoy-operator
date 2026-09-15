"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";
import { cn } from "@/lib/cn";

/**
 * A sheet that comes up from the bottom of the screen.
 *
 * Built here rather than on `<dialog>`: `showModal()` has to be driven from an
 * effect, which means the first paint is the page WITHOUT the sheet and the
 * second is with it. On a jetty phone that is a visible flash, and the sheet is
 * the whole answer to a tap.
 *
 * What it owes the person using it, and all three were things a plain div
 * would not do:
 *
 *   - **Escape closes it.** The one gesture everybody tries.
 *   - **The page behind does not scroll.** A sheet whose backdrop scrolls
 *     loses the operator's place in the grid they opened it from.
 *   - **Focus goes in and comes back.** Opening moves focus into the sheet, so
 *     a screen reader is reading the sheet rather than the page under it, and
 *     closing puts it back on whatever opened it.
 *
 * `aria-modal` is the claim that the rest of the page is inert. It is honest
 * here because the backdrop covers it and Escape is the way out; a full focus
 * trap is the one thing this does not do, and tabbing past the last control
 * reaches the page behind rather than wrapping.
 */
export function Sheet({
  title,
  onClose,
  children,
  className,
}: {
  /** Named for a screen reader, and drawn as the sheet's heading. */
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);

    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/*
        The backdrop is a button so a tap outside closes the sheet, which is
        the second gesture everybody tries. Hidden from the accessibility tree:
        Escape and the close control are the two ways out that are announced,
        and a third unnamed one in the middle of them is noise.
      */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="bg-forest/40 absolute inset-0 cursor-default"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        className={cn(
          "rounded-t-card border-paper-line bg-paper text-forest relative max-h-[88vh] w-full max-w-xl overflow-y-auto border p-5 pb-8 outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 id={headingId} className="font-display text-2xl">
            {title}
          </h2>
          <IconButton
            label="Close"
            variant="onPaper"
            onClick={onClose}
            className="-mt-1 shrink-0"
          >
            <CloseIcon className="size-5" />
          </IconButton>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}
