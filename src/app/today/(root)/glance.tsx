import Link from "next/link";
import { cn } from "@/lib/cn";
import type { MoneyLine } from "@/lib/home/money";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

/**
 * The two one-line blocks at the foot of Home (yuvoy-operator#96 blocks 4 and
 * 5): money today, for a login that can manage, and the listings at a
 * glance. Each is one row that opens the tab where the whole of it lives, so
 * Home stays the day and the catalogue stays on Business.
 */
export function Glance({
  id,
  heading,
  href,
  text,
  tone = "plain",
}: {
  id: string;
  heading: string;
  href: string;
  text: string;
  /** A figure that needs reading twice: a week that pays less than nothing. */
  tone?: "plain" | "alert";
}) {
  return (
    <section aria-labelledby={id} className="mt-8">
      <h2 id={id} className="label text-forest/75">
        {heading}
      </h2>
      <Link
        href={href}
        className={panelClass(
          "raised",
          "ease-interaction hover:bg-paper mt-3 flex items-center gap-3 px-4 py-3 transition-colors duration-200",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 text-base font-bold",
            tone === "alert" && "text-terra-deep",
          )}
        >
          {text}
        </span>
        <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
      </Link>
    </section>
  );
}

/** Money today, or the sentence for a read that did not answer. */
export function MoneyGlance({ line }: { line: MoneyLine | null }) {
  return (
    <Glance
      id="home-money"
      heading="Money"
      href="/earnings"
      text={line ? line.text : "Money did not load. Open Money"}
      tone={!line || line.owedBack || line.missing ? "alert" : "plain"}
    />
  );
}
