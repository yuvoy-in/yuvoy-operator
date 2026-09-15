import Link from "next/link";
import { STEPS, STEP_LABEL, type Step } from "@/lib/services/builder";
import { cn } from "@/lib/cn";

/**
 * The seven, and which one is open — yuvoy-operator#58 item 7.
 *
 * A step holding a `publishBlockers` field is marked unfinished. That mark is
 * the whole reason this is a list rather than a progress bar: an operator who
 * closed the builder on Selling and came back needs to see that Basics is the
 * one still missing something, not that they are four sevenths of the way
 * through.
 *
 * Every step is reachable, including ones ahead. The draft is saved step by
 * step and nothing depends on the order, so a wizard that locked Review until
 * Basics was perfect would trap somebody who only wanted to check what was
 * left.
 */
export function Stepper({
  id,
  current,
  unfinished,
}: {
  /** Empty before the draft exists: the steps are then unreachable links. */
  id: string;
  current: Step;
  unfinished: ReadonlySet<Step>;
}) {
  return (
    <nav aria-label="Steps" className="mt-6">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((step, i) => {
          const open = step === current;
          const label = `${i + 1}. ${STEP_LABEL[step]}`;
          const body = (
            <>
              {label}
              {unfinished.has(step) ? (
                <span className="text-terra-deep"> ·</span>
              ) : null}
            </>
          );
          return (
            <li key={step}>
              {id ? (
                <Link
                  href={`/account/listings/${id}/edit?step=${step}`}
                  aria-current={open ? "step" : undefined}
                  className={cn(
                    "rounded-control tap-target inline-flex items-center px-3 py-1.5 text-sm transition-colors duration-200",
                    open
                      ? "bg-forest text-cream"
                      : "border-cream-line text-forest/75 hover:bg-cream-deep border",
                  )}
                >
                  {body}
                </Link>
              ) : (
                <span
                  aria-current={open ? "step" : undefined}
                  className={cn(
                    "rounded-control inline-flex items-center px-3 py-1.5 text-sm",
                    /*
                      Not `text-forest/40`. The palette's opacity floor exists
                      because anything under it fails AA on cream, and "this
                      step is not reachable yet" is not worth an unreadable
                      label. It is a span rather than a link, which is the
                      difference that matters.
                    */
                    open
                      ? "bg-forest text-cream"
                      : "border-cream-line text-forest/75 border",
                  )}
                >
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      {unfinished.size > 0 ? (
        <p className="text-forest/70 mt-2 text-xs">
          A dot marks a step still missing something we need before this can be
          published.
        </p>
      ) : null}
    </nav>
  );
}
