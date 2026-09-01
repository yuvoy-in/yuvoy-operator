"use client";

import { useActionState } from "react";
import Link from "next/link";
import { acceptInvite, type AcceptState } from "./actions";

export function JoinForm() {
  const [state, act, pending] = useActionState<AcceptState, FormData>(
    acceptInvite,
    {},
  );

  if (state.accepted) {
    return (
      <div
        role="status"
        className="rounded-edge border-forest bg-forest/5 mt-8 border-2 p-5"
      >
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
        <Link
          href="/sign-in"
          className="rounded-edge dock-target label bg-forest text-cream mt-4 flex items-center justify-center px-5 font-bold"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <form action={act} className="mt-8 space-y-5">
      <div>
        <label htmlFor="join-phone" className="label text-forest/75">
          Your phone number
        </label>
        <input
          id="join-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="+919000000101"
          className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 font-mono text-base"
        />
        <p className="text-forest/70 mt-1.5 text-xs">
          The number the invitation was sent to, with its country code.
        </p>
      </div>

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
          className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 font-mono text-2xl tracking-[0.4em]"
        />
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-edge dock-target label bg-forest text-cream w-full px-5 font-bold disabled:cursor-not-allowed disabled:opacity-55"
      >
        {pending ? "Accepting…" : "Accept the invitation"}
      </button>
    </form>
  );
}
