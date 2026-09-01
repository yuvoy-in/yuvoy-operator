import { cn } from "@/lib/cn";

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-edge border-cream-line bg-cream-deep border p-6">
      <p className="text-base font-bold">{title}</p>
      <p className="text-forest/70 mt-2 text-sm">{body}</p>
    </div>
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
    <div className="rounded-edge border-terra-deep bg-cream-deep border-2 p-6">
      <p className="text-terra-deep text-base font-bold">{title}</p>
      <p className="text-forest/80 mt-2 text-sm">{body}</p>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("rounded-edge bg-cream-line/70 animate-pulse", className)}
      aria-hidden
    />
  );
}
