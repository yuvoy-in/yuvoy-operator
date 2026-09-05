"use client";

import { useActionState, useState } from "react";
import { acceptInvite, type AcceptState } from "./actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { PhoneField } from "@/components/ui/phone-field";

export function JoinForm() {
  const [state, act, pending] = useActionState<AcceptState, FormData>(
    acceptInvite,
    {},
  );
  /** The submit waits for a whole number, as the other two doors do. */
  const [complete, setComplete] = useState(false);

  if (state.accepted) {
    return (
      <Panel tone="done" role="status" className="mt-8">
        <p className="text-base font-bold">You are on the account</p>
        {/*
          Accepting is not signing in, and the screen must not blur that. The
          API mints no session here on purpose — one code path creates operator
          sessions rather than two. So this says what actually happened and
          points at the ordinary door.
        */}
        <p className="text-forest/80 mt-2 text-sm">
          Accepting does not sign you in. Sign in with the same number and we
          will send you a fresh code.
        </p>
        <ButtonLink href="/sign-in" className="mt-4">
          Sign in
        </ButtonLink>
      </Panel>
    );
  }

  return (
    <form action={act} className="mt-8 space-y-5">
      {/*
        The same field as sign-in and signup, and it was not in
        yuvoy-operator#19's list — which is exactly why it goes in here. Three
        phone fields with two of them fixed is the drift that issue is about.
      */}
      <PhoneField
        id="join-phone"
        autoFocus={false}
        hint="The number the invitation was sent to."
        onCompleteChange={setComplete}
      />

      <div>
        <label htmlFor="join-code" className="label text-forest/75">
          The code we sent you
        </label>
        <input
          id="join-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          className={inputClass("mt-2 font-mono text-2xl tracking-[0.4em]")}
        />
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || !complete}>
        {pending ? "Accepting…" : "Accept the invitation"}
      </Button>
    </form>
  );
}
