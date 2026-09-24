import Link from "next/link";
import { STEPS, STEP_LABEL, type Step } from "@/lib/services/builder";
import { cn } from "@/lib/cn";

/**
 * Where you are in the seven, said once (yuvoy-operator#85 s11).
 *
 * It was seven chips carrying "1. Basics" through "7. Review", which wrapped
 * over two rows on a phone and spent the top of every step on a menu. It is
 * now the sentence "Step 1 of 7 · Basics" over one thin seven-segment bar:
 * the same seven targets, at the weight a progress indicator is worth.
 *
 * ## The mark on a step still missing something
 *
 * A step holding a `publishBlockers` field is drawn in terracotta AND carries
 * a dot, AND says so in its accessible name. Colour alone is not a signal: an
 * operator who cannot tell terracotta from forest gets the dot, and one who
 * sees nothing at all gets the words. That mark is why the bar is seven links
 * rather than a percentage: somebody who closed the builder on Selling needs
 * to see that Basics is the one still missing something, not that they are
 * four sevenths of the way through.
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
  /** Empty before the draft exists: the steps are then unreachable. */
  id: string;
  current: Step;
  unfinished: ReadonlySet<Step>;
}) {
  const at = STEPS.indexOf(current);

  return (
    <nav aria-label="Steps" className="mt-6">
      <p className="text-forest/75 text-sm font-medium">
        Step {at + 1} of {STEPS.length} · {STEP_LABEL[current]}
      </p>

      <ol className="mt-2 flex gap-1.5">
        {STEPS.map((step, i) => {
          const open = step === current;
          const short = unfinished.has(step);
          /*
            The segment carries no visible words, so this is the only name it
            has. It says the number, the step and whether it is still missing
            something, which is everything the bar says in colour.
          */
          const name = `Step ${i + 1}, ${STEP_LABEL[step]}${
            short ? ", still missing something" : ""
          }`;
          /*
            44px of target around a 4px bar. The bar is what a thin progress
            indicator should be; the tap area is what a thumb on a jetty needs,
            and the two are not the same measurement.
          */
          const inside = "flex h-11 flex-col items-center justify-center gap-1";
          const body = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "w-full rounded-full transition-[height,background-color] duration-200",
                  open ? "h-1.5" : "h-1",
                  short ? "bg-terra-deep" : open ? "bg-forest" : "bg-forest/20",
                )}
              />
              {/*
                Drawn either way, transparent when there is nothing to mark, so
                a dot appearing never moves the bar it sits under.
              */}
              <span
                aria-hidden="true"
                className={cn(
                  "size-1 rounded-full",
                  short ? "bg-terra-deep" : "bg-transparent",
                )}
              />
              <span className="sr-only">{name}</span>
            </>
          );

          return (
            <li key={step} className="flex-1">
              {id ? (
                <Link
                  href={`/account/listings/${id}/edit?step=${step}`}
                  aria-current={open ? "step" : undefined}
                  className={inside}
                >
                  {body}
                </Link>
              ) : (
                /*
                  A span rather than a link, which is the difference that
                  matters: there is no draft to open yet.
                */
                <span
                  aria-current={open ? "step" : undefined}
                  className={inside}
                >
                  {body}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {unfinished.size > 0 ? (
        <p className="text-forest/70 mt-1 text-xs">
          A dot marks a step still missing something we need before this can be
          published.
        </p>
      ) : null}
    </nav>
  );
}
