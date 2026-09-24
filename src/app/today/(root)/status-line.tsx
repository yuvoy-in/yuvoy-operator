import Link from "next/link";
import { cn } from "@/lib/cn";
import type {
  SellingStatus,
  StatusReason,
  StatusTone,
} from "@/lib/home/status";
import { ChevronRightIcon } from "@/components/ui/icons";
import { panelClass } from "@/components/ui/panel";

/**
 * Whether the business is selling, in one line at the top of Home
 * (yuvoy-operator#96 block 1). "Tap opens the reasons."
 *
 * A native `<details>`: it opens on the first tap before any script has
 * arrived, on the one bar of signal Home is opened on, and a screen reader
 * already knows it as a button that expands. A line with nothing to explain
 * is not a control at all.
 *
 * The tone rides a dot and, for an account that cannot sell, the alert panel;
 * the words carry the state on their own.
 */
const DOT: Record<StatusTone, string> = {
  selling: "bg-forest",
  attention: "bg-terra",
  blocked: "bg-terra-deep",
  unknown: "border border-forest/50",
};

/** A way forward under a reason: a small link, 28px tall at least. */
const ACTION =
  "text-terra-deep tap-target text-sm font-bold underline underline-offset-4";

export function StatusLine({ status }: { status: SellingStatus }) {
  const blocked = status.tone === "blocked";
  const line = (
    <>
      <span
        aria-hidden="true"
        className={cn("size-2.5 shrink-0 rounded-full", DOT[status.tone])}
      />
      <span
        className={cn(
          "min-w-0 flex-1 text-base font-bold",
          blocked && "text-terra-deep",
        )}
      >
        {status.line}
      </span>
    </>
  );

  if (status.reasons.length === 0) {
    return (
      <p
        className={panelClass(
          blocked ? "alert" : "raised",
          "flex min-h-12 items-center gap-3 px-4 py-3",
        )}
      >
        {line}
      </p>
    );
  }

  return (
    <details
      className={cn(panelClass(blocked ? "alert" : "raised"), "group p-0")}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
        {line}
        <ChevronRightIcon className="text-terra-deep ease-interaction size-5 shrink-0 rotate-90 transition-transform duration-200 group-open:-rotate-90" />
      </summary>
      <ul className="border-paper-line mx-4 space-y-2 border-t pt-3 pb-4">
        {status.reasons.map((reason, i) => (
          <Reason key={i} reason={reason} />
        ))}
        {status.more ? (
          <li>
            <Link href={status.more.href} className={ACTION}>
              {status.more.action}
            </Link>
          </li>
        ) : null}
      </ul>
    </details>
  );
}

function Reason({ reason }: { reason: StatusReason }) {
  const action =
    reason.href && reason.action ? (
      reason.href.startsWith("tel:") ? (
        <a href={reason.href} className={ACTION}>
          {reason.action}
        </a>
      ) : (
        <Link href={reason.href} className={ACTION}>
          {reason.action}
        </Link>
      )
    ) : null;

  return (
    <li className="text-sm">
      <p className="text-forest/80">{reason.text}</p>
      {action}
    </li>
  );
}
