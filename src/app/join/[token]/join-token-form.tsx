"use client";

import { useActionState, useState } from "react";
import { acceptJoin, requestJoinCode, type JoinState } from "./actions";
import { codeStep } from "./code-step";
import { roleLabel } from "@/lib/team/roles";
import { Button, ButtonLink } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { PhoneField } from "@/components/ui/phone-field";
import { Panel } from "@/components/ui/panel";

/**
 * Three steps, and one of them can take somebody's job away.
 *
 * phone → code → in. The middle step is where this differs from every other
 * form in the portal: "one number works with one business at a time", so
 * accepting can end an existing membership and drop its sessions. Somebody
 * mid-shift loses their employer's manifest.
 *
 * So `confirmLeaving` is never sent by default. `leavingBusiness` coming back
 * from the code step means **ask**, and the 409 on accept means ask again —
 * the screen handles both, because the warning is advisory and the 409 is the
 * authoritative answer.
 */
export function JoinTokenForm({
  token,
  businessName,
}: {
  token: string;
  businessName?: string;
}) {
  const [state, act, pending] = useActionState<JoinState, FormData>(
    async (prev, form) => {
      if (prev.step === "code") return acceptJoin(token, prev, form);
      return requestJoinCode(token, prev, form);
    },
    { step: "phone" },
  );
  /** The submit waits for a whole number. See `PhoneField`. */
  const [complete, setComplete] = useState(false);
  /**
   * Their agreement to leave, held here rather than in the action's state.
   *
   * It must come from a tap and nothing else, so it is reset by any re-render
   * that hands back a fresh state — there is no path where it survives into a
   * request the person did not authorise.
   */
  const [agreed, setAgreed] = useState(false);

  if (state.step === "done") {
    return (
      <Panel tone="done" role="status" className="mt-8">
        <p className="text-lg font-bold">
          You are on {state.invited?.businessName ?? businessName ?? "the team"}
        </p>
        {/*
          Reached only when the account cannot hold a session — the join
          happened, so this is not an error. The ordinary path signs them in
          and redirects, and never renders this panel at all.
        */}
        <p className="text-forest/80 mt-2 text-sm">
          Sign in with the same number and ask for a code.
        </p>
        <ButtonLink href="/sign-in" className="mt-5">
          Go to sign in
        </ButtonLink>
      </Panel>
    );
  }

  const leaving = state.leavingBusiness;
  /* What this step can honestly show when no code was sent. See `codeStep`. */
  const step = codeStep(state, businessName);
  /** An unanswered "this takes you off another business" is on screen. */
  const askingToLeave =
    state.step === "code" && Boolean(leaving && step.leavingText);

  return (
    <form action={act} className="mt-8 space-y-5">
      {state.step === "phone" ? (
        <PhoneField
          autoFocus
          invalid={Boolean(state.message)}
          onCompleteChange={setComplete}
          hint="The number you were invited on."
        />
      ) : (
        <>
          {/*
            What they are actually accepting, before they accept it. The code
            step is the first moment the API can say — it knows who the number
            belongs to, and the page before it deliberately did not.
          */}
          {state.invited?.role ? (
            <Panel className="p-4">
              <p className="text-sm">
                You have been added to{" "}
                <span className="font-bold">
                  {state.invited.businessName ?? businessName}
                </span>{" "}
                as{" "}
                <span className="font-bold">
                  {roleLabel(state.invited.role)}
                </span>
                {state.invited.name ? `, as ${state.invited.name}` : ""}.
              </p>
            </Panel>
          ) : null}

          {/*
            The destructive half, named and asked rather than assumed.

            "The previous membership is ended and its sessions dropped, so
            somebody who has left cannot keep reading their old employer's
            manifest from an open tab." That is the right behaviour and exactly
            why it needs a deliberate tap: it happens to a person who may be
            standing on a jetty using the other business's app right now.
          */}
          {/*
            Nothing was sent (yuvoy-api#227), so it says so first and in the
            API's own words: the only person who can fix it is whoever sent
            the invitation. No code box follows it, because nothing is coming
            to type into it.
          */}
          {step.notSent ? (
            <Panel tone="alert" role="alert" className="p-4">
              <p className="text-sm font-bold">{step.notSent}</p>
            </Panel>
          ) : null}

          {leaving && step.leavingText ? (
            <Panel tone="alert" className="p-4">
              <p className="text-sm font-bold">
                This will take you off {leaving}
              </p>
              <p className="text-forest/90 mt-2 text-sm">{step.leavingText}</p>
              <label className="mt-3 flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="accent-terra-deep mt-0.5 size-5 shrink-0"
                />
                <span>Yes, take me off {leaving}.</span>
              </label>
            </Panel>
          ) : null}

          {step.askForCode ? (
            <div>
              <label htmlFor="code" className="label text-forest/75">
                Your code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                required
                autoFocus
                className={inputClass(
                  "mt-2 font-mono text-2xl tracking-[0.4em]",
                )}
              />
              {/*
              "For", not "sent to" — the same rule `/sign-in` and `/signup`
              keep, and `pnpm qa` enforces on all three. A code may arrive by
              WhatsApp or be handed over by Yuvoy, and this screen is never told
              which.
            */}
              <p className="text-forest/70 mt-2 text-sm">
                For the number you entered. It lasts a few minutes.
              </p>
              {state.devCode ? (
                <p className="rounded-card border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
                  Development build: the code is{" "}
                  <strong className="font-mono">{state.devCode}</strong>. This
                  never appears in production.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {/*
        The agreement travels as a field rather than as component state the
        action could read stale. Absent unless the box is ticked, which is what
        keeps `confirmLeaving` out of every request nobody authorised.
      */}
      {askingToLeave && agreed ? (
        <input type="hidden" name="confirmLeaving" value="yes" />
      ) : null}

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      {state.step === "phone" || step.askForCode ? (
        <Button
          type="submit"
          disabled={
            pending ||
            (state.step === "phone" && !complete) ||
            // Nothing may be sent while an unanswered "this removes you from
            // somewhere" is on screen.
            (askingToLeave && !agreed)
          }
        >
          {pending
            ? "Working…"
            : state.step === "code"
              ? askingToLeave
                ? `Join and leave ${leaving}`
                : "Join"
              : "Continue"}
        </Button>
      ) : null}
    </form>
  );
}
