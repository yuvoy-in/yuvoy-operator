import Link from "next/link";
import type { WaitingItem } from "@/lib/account/waiting";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

/**
 * What is waiting on the operator, on the business profile: how many, and
 * what each one is (yuvoy-operator#86 s9).
 *
 * "'2 things waiting on you' does not say what they are. The one thing on this
 * screen that needs action is the one thing that stays vague." The count opens
 * Verification, where each is explained; each thing opens the screen that
 * fixes it.
 *
 * The rows are `waitingItems(blocking)`: exactly the blockers the Business
 * tab's badge counts, in the same order, so the badge, the count and the rows
 * cannot disagree. Draws nothing when nothing is waiting.
 */
export function WaitingStrip({ items }: { items: readonly WaitingItem[] }) {
  if (items.length === 0) return null;
  return (
    /*
      `overflow-hidden` so a row's hover fill keeps the panel's corners, and
      the rows' focus rings are drawn inside them so the clipping never hides
      one.
    */
    <div className={panelClass("alert", "mt-6 overflow-hidden p-0")}>
      <Link
        href="/account/verification"
        className="ease-interaction hover:bg-paper flex items-center justify-between gap-4 p-4 transition-colors duration-200 focus-visible:-outline-offset-2"
      >
        <span className="text-base font-bold">
          {items.length === 1
            ? "1 thing waiting on you"
            : `${items.length} things waiting on you`}
        </span>
        <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
      </Link>
      <ul className="border-paper-line divide-paper-line divide-y border-t">
        {items.map((item, i) => (
          <li key={`${item.href ?? item.text}-${i}`}>
            {item.href ? (
              <Link
                href={item.href}
                className="ease-interaction hover:bg-paper flex min-h-12 items-center justify-between gap-4 px-4 py-3 transition-colors duration-200 focus-visible:-outline-offset-2"
              >
                <span className="min-w-0 text-base">{item.text}</span>
                <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
              </Link>
            ) : (
              /*
                Something this login cannot do: said, with who can, rather than
                a link to a screen that would only say so after the tap.
              */
              <div className="min-h-12 px-4 py-3">
                <p className="text-base">{item.text}</p>
                <p className="text-forest/70 mt-0.5 text-sm">
                  An owner, admin or manager can do this.
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
