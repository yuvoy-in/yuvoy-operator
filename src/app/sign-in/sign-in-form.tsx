"use client";

import { useActionState } from "react";
import { requestCode, submitCode, type SignInState } from "./actions";
import { Button } from "@/components/ui/button";

/**
 * Two steps in one form, driven entirely by Server Actions.
 *
 * There is no fetch here and no token here. `useActionState` posts to the
 * action, the action talks to `/operator/v1` on the server, and the session
 * comes back as an httpOnly cookie this component cannot read — which is the
 * whole point of the portal's architecture and not an inconvenience to work
 * around later.
 */
export function SignInForm() {
  const [state, act, pending] = useActionState<SignInState, FormData>(
    async (prev, form) =>
      prev.step === "code" ? submitCode(prev, form) : requestCode(prev, form),
    { step: "phone" },
  );

  return (
    <form action={act} className="mt-8 space-y-5">
      {state.step === "phone" ? (
        <div>
          <label htmlFor="phone" className="label text-forest/75">
            Your phone number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required
            autoFocus
            placeholder="+91 90000 00101"
            className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 text-lg"
          />
          <p className="text-forest/70 mt-2 text-sm">
            The number Yuvoy has for your business. We send a code to it.
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="code" className="label text-forest/75">
            The code we sent
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
            className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 font-mono text-2xl tracking-[0.4em]"
          />
          <p className="text-forest/70 mt-2 text-sm">
            Sent to {state.phone}. It lasts a few minutes.
          </p>
          {state.devCode ? (
            <p className="rounded-edge border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
              Development build — the code is{" "}
              <strong className="font-mono">{state.devCode}</strong>. This never
              appears in production.
            </p>
          ) : null}
        </div>
      )}

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending
          ? "Working…"
          : state.step === "code"
            ? "Sign in"
            : "Send me a code"}
      </Button>
    </form>
  );
}
