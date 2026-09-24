"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * The frame every step shares — yuvoy-operator#58 item 7.
 *
 * One Next button, and it is the only thing that saves. No timer autosave, no
 * Save of its own: two ways to save a form is two ways for an operator to be
 * unsure which one took. Back is a link rather than a button for the same
 * reason, because "Back saves nothing" and a button beside Next reads as
 * though it might.
 *
 * ## One title (yuvoy-operator#80 t2, #85 s11)
 *
 * Every step said its name twice: "Step 1 of 7 · Basics" over the bar, then
 * "Basics" again as a large heading, and under that a line describing the
 * step. The stepper names it; the heading is kept for a screen reader, which
 * navigates by headings and is not shown the bar's sentence as one, and the
 * line is kept only where it changes what somebody does ("You can leave this
 * empty"). The examples under the fields stay: they change what gets typed.
 */
export function StepShell({
  title,
  blurb,
  action,
  pending,
  message,
  back,
  nextLabel = "Next",
  children,
}: {
  title: string;
  /** Only a sentence that changes a decision; never one describing the step. */
  blurb?: string;
  action: (formData: FormData) => void;
  pending: boolean;
  message?: string;
  /** Where Back goes. Absent on the first step, which has nowhere to go. */
  back?: string;
  nextLabel?: string;
  children: ReactNode;
}) {
  return (
    <Panel className="mt-6">
      <h2 className="sr-only">{title}</h2>
      {blurb ? <p className="text-forest/70 text-sm">{blurb}</p> : null}

      <form action={action} className={blurb ? "mt-5 space-y-5" : "space-y-5"}>
        {children}

        {message ? (
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {message}
          </p>
        ) : null}

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" block={false} disabled={pending}>
            {pending ? "Saving…" : nextLabel}
          </Button>
          {back ? (
            <Link
              href={back}
              className="text-forest/75 tap-target text-sm underline underline-offset-4"
            >
              Back
            </Link>
          ) : null}
        </div>
      </form>
    </Panel>
  );
}
