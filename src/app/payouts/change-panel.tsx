"use client";

import { useActionState } from "react";
import { cancelChange, type CancelState } from "./actions";
import { describeChange, type ChangeState } from "@/lib/account/bank";
import { marketTime, marketDay } from "@/lib/format/market-time";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

/**
 * A bank change in flight, and the brake beside it.
 *
 * Both clocks are shown, always, because the design is only defensible if the
 * operator can see it working: one window before approval so the real owner
 * can stop it, one after, so even an approved change is still catchable.
 *
 * "This wasn't me" is prominent at every stoppable stage — a stolen login plus
 * one convincing phone call is otherwise enough to redirect a season's
 * takings, and the brake must be closer to hand than the accelerator.
 */
export function ChangePanel({
  id,
  state,
  summary,
  objectionUntil,
  coolingUntil,
  requestedAt,
}: {
  id: string;
  state: ChangeState;
  summary?: string;
  objectionUntil?: string | null;
  coolingUntil?: string | null;
  requestedAt?: string;
}) {
  const [result, act, pending] = useActionState<CancelState, FormData>(
    cancelChange,
    {},
  );
  const { title, body, stoppable } = describeChange(state);

  if (result.stopped) {
    return (
      <Panel tone="done">
        <p className="text-base font-bold">Stopped. Nothing was changed.</p>
        <p className="text-forest/80 mt-2 text-sm">
          Payouts still go to the account you had. If you did not raise this in
          the first place, change your sign-in and tell us.
        </p>
      </Panel>
    );
  }

  const tz = "Asia/Kolkata";
  const clock = (iso?: string | null) =>
    iso ? `${marketTime(iso, tz)} on ${marketDay(iso, tz)}` : null;

  return (
    <Panel tone={stoppable ? "alert" : "raised"}>
      <p className="text-base font-bold">{title}</p>
      {summary ? (
        <p className="text-forest/90 mt-2 font-mono text-sm">{summary}</p>
      ) : null}
      <p className="text-forest/80 mt-2 text-sm">{body}</p>

      {/* Both clocks, always — the design is only trustworthy if it is visible. */}
      <dl className="border-cream-line mt-4 space-y-2 border-t pt-4 text-sm">
        {requestedAt ? (
          <Row label="Raised" value={clock(requestedAt) ?? "—"} />
        ) : null}
        <Row
          label="You can object until"
          value={clock(objectionUntil) ?? "The window has closed"}
        />
        <Row
          label="Goes live"
          value={
            clock(coolingUntil) ??
            "Not yet scheduled — a person must approve it first"
          }
        />
      </dl>

      {stoppable ? (
        <form action={act} className="mt-5">
          <input type="hidden" name="id" value={id} />
          <p className="text-terra-deep text-sm font-bold">
            Did you not ask for this?
          </p>
          <p className="text-forest/80 mt-1 text-sm">
            Stop it now. It takes no code and no waiting — that is deliberate.
          </p>
          <Button
            type="submit"
            disabled={pending}
            variant="danger"
            className="mt-3"
          >
            {pending ? "Stopping…" : "This wasn't me — stop it"}
          </Button>
        </form>
      ) : null}

      {result.message ? (
        <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
          {result.message}
        </p>
      ) : null}
    </Panel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-forest/70">{label}</dt>
      <dd className="text-right font-bold">{value}</dd>
    </div>
  );
}
