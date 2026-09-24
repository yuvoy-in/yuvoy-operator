import Link from "next/link";
import { cn } from "@/lib/cn";
import type { ChecklistStep } from "@/lib/home/checklist";
import { CheckIcon, ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

/**
 * Start selling: the checklist a new business sees in place of the day, the
 * money and the listings, until its first sale or its last step
 * (yuvoy-operator#96, "States Home must handle").
 *
 * An ordered list, because the steps are an order: nothing sells without the
 * details and the documents, a departure needs a listing, and a reel sells
 * the listing. A step that is done is ticked and stays in place, so the list
 * does not move under a thumb; one this login cannot take has no link.
 */
export function StartSelling({ steps }: { steps: ChecklistStep[] }) {
  const done = steps.filter((s) => s.done).length;

  return (
    <section aria-labelledby="start-selling" className="mt-8">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="start-selling" className="label text-forest/75">
          Start selling
        </h2>
        <p className="text-forest/70 text-sm tabular-nums">
          {done} of {steps.length} done
        </p>
      </div>
      <ol className="mt-3 space-y-2">
        {steps.map((step) => (
          <li key={step.key}>
            <Step step={step} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function Step({ step }: { step: ChecklistStep }) {
  const mark = step.done ? (
    <span className="bg-forest text-paper flex size-6 shrink-0 items-center justify-center rounded-full">
      <CheckIcon className="size-4" />
    </span>
  ) : (
    <span
      aria-hidden="true"
      className="border-forest/40 size-6 shrink-0 rounded-full border-2"
    />
  );
  const words = (
    <span
      className={cn(
        "min-w-0 flex-1 text-base",
        step.done ? "text-forest/70" : "font-bold",
      )}
    >
      {step.done ? <span className="sr-only">Done: </span> : null}
      {step.label}
    </span>
  );
  const row = "flex min-h-14 items-center gap-3 px-4 py-3";

  if (step.done || !step.href) {
    return (
      <div className={panelClass(step.done ? "outline" : "raised", row)}>
        {mark}
        {words}
      </div>
    );
  }

  return (
    <Link
      href={step.href}
      className={panelClass(
        "raised",
        cn(
          row,
          "ease-interaction hover:bg-paper transition-colors duration-200",
        ),
      )}
    >
      {mark}
      {words}
      <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
    </Link>
  );
}
