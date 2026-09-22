"use client";

import { useActionState, useState } from "react";
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
 * "This wasn't me" is on the panel at every stoppable stage: a stolen login
 * plus one convincing phone call is otherwise enough to redirect a season's
 * takings, and the brake must be closer to hand than the accelerator.
 *
 * ## Two taps, and why that is still closer to hand
 *
 * Stopping cannot be undone: an owner who did ask for the change has to raise
 * it again, with a new code and both clocks from the start. So it follows the
 * rule every destructive action in the portal now follows (yuvoy-operator#81):
 * the words in the warning colour, and a confirm that says what happens, whose
 * button carries the danger pill. It is still no code and no waiting, which
 * raising a change never is.
 */
export function ChangePanel({
  id,
  state,
  summary,
  objectionUntil,
  coolingUntil,
  requestedAt,
  canStop,
}: {
  id: string;
  state: ChangeState;
  summary?: string;
  objectionUntil?: string | null;
  coolingUntil?: string | null;
  requestedAt?: string;
  /**
   * Whether this person may stop the change — **OWNER or ADMIN**, which is a
   * WIDER set than the one that may raise it.
   *
   * The two are deliberately different in the contract and were the same one
   * flag here: raising a bank change is OWNER only ("a stolen login plus one
   * convincing phone call is otherwise enough to redirect a season's
   * takings"), while stopping one is OWNER or ADMIN — because stopping is the
   * SAFETY action, and an admin exists precisely for an owner who is off the
   * island. Denying it is the wrong direction to be wrong in.
   *
   * Before this the control was ungated entirely, so a STAFF login saw a
   * button that could only ever answer 403.
   */
  canStop: boolean;
}) {
  const [result, act, pending] = useActionState<CancelState, FormData>(
    cancelChange,
    {},
  );
  const [confirming, setConfirming] = useState(false);
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
      <dl className="border-paper-line mt-4 space-y-2 border-t pt-4 text-sm">
        {requestedAt ? (
          <Row label="Raised" value={clock(requestedAt) ?? "-"} />
        ) : null}
        <Row
          label="You can object until"
          value={clock(objectionUntil) ?? "The window has closed"}
        />
        <Row
          label="Goes live"
          value={
            clock(coolingUntil) ??
            "Not yet scheduled: a person must approve it first"
          }
        />
      </dl>

      {stoppable && !canStop ? (
        /*
          Said, rather than shown as a button that will 403.

          The refusal is knowable from what is already on screen, so it is said
          here — the rule every role gate in this portal follows. A staff phone
          on a jetty should not discover this after tapping.
        */
        <p className="text-forest/80 mt-5 text-sm">
          If this was not asked for, an owner or an admin can stop it. Your role
          cannot. Tell them now rather than waiting.
        </p>
      ) : null}

      {stoppable && canStop ? (
        confirming ? (
          <form action={act} className="border-paper-line mt-5 border-t pt-4">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm font-bold">Stop this change?</p>
            {/* What happens, named before the tap that does it. */}
            <p className="text-forest/80 mt-1.5 text-sm">
              Payouts keep going to the account you have. If you did ask for it,
              you will need to raise it again.
            </p>
            <div className="mt-4 flex gap-2">
              <Button
                type="submit"
                disabled={pending}
                variant="danger"
                block={false}
                className="flex-1"
              >
                {pending ? "Stopping…" : "Stop the change"}
              </Button>
              <Button
                onClick={() => setConfirming(false)}
                disabled={pending}
                variant="secondary"
                block={false}
                className="flex-1"
              >
                Back
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-5">
            <p className="text-terra-deep text-sm font-bold">
              Did you not ask for this?
            </p>
            <p className="text-forest/80 mt-1 text-sm">
              Stop it now. It takes no code and no waiting.
            </p>
            <Button
              onClick={() => setConfirming(true)}
              variant="danger-quiet"
              size="md"
              block={false}
              className="mt-2"
            >
              {"This wasn't me. Stop it"}
            </Button>
          </div>
        )
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
