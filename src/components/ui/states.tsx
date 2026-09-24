import { cn } from "@/lib/cn";
import { Panel } from "./panel";

export function Empty({ title, body }: { title: string; body?: string }) {
  return (
    <Panel className="p-6">
      <p className="text-base font-bold">{title}</p>
      {body ? <p className="text-forest/70 mt-2 text-sm">{body}</p> : null}
    </Panel>
  );
}

/**
 * Something went wrong, said plainly.
 *
 * There is no error code and no request id on screen. The person reading this
 * is on a dock, and a correlation id is for a support conversation that
 * happens later — it goes to the logs, not into sunlight.
 */
export function Problem({ title, body }: { title: string; body: string }) {
  return (
    <Panel tone="alert" className="p-6">
      <p className="text-terra-deep text-base font-bold">{title}</p>
      <p className="text-forest/80 mt-2 text-sm">{body}</p>
    </Panel>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-card", className)} aria-hidden />;
}
