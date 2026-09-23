import type { HelpSection } from "@/lib/help/sections";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

/**
 * Every answer, one closed question per row, grouped by where it comes up.
 *
 * A `<details>` per answer rather than a page of paragraphs: an operator comes
 * here with one question, and a list of questions is scanned in seconds where
 * the answers under them would be scrolled past. The row's `id` is the topic's,
 * so `helpHref(id)` from any screen lands on it, and `OpenFromHash` opens it.
 *
 * No hooks and no `open` prop, on purpose: the server and the client render
 * the same closed markup, which is what lets the fragment open one after
 * hydration without the two disagreeing.
 */
export function HelpTopics({ sections }: { sections: readonly HelpSection[] }) {
  return (
    <>
      {sections.map(({ area, topics }) => {
        const headingId = `help-area-${area.toLowerCase()}`;
        return (
          <section key={area} className="mt-8" aria-labelledby={headingId}>
            <h2 id={headingId} className="label text-forest/75">
              {area}
            </h2>
            <div className="mt-2 space-y-2">
              {topics.map((topic) => (
                <details
                  key={topic.id}
                  id={topic.id}
                  /*
                    `scroll-mt` so a landing from another screen does not pin
                    the question under the top edge of the phone.
                  */
                  className={panelClass("raised", "group scroll-mt-6 p-0")}
                >
                  <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-base font-bold [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0">{topic.question}</span>
                    <ChevronRightIcon className="text-terra-deep ease-interaction size-5 shrink-0 transition-transform duration-200 group-open:rotate-90" />
                  </summary>
                  <div className="text-forest/80 space-y-3 px-4 pb-4 text-sm">
                    {topic.answer.map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
