"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createAccount, type SignUpState } from "./actions";
import { Button, ButtonLink } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * One step, one Server Action, no client-side API call.
 *
 * The success panel replaces the form rather than sitting under it: a form
 * still on screen beside "we have that" invites a second submission, and a
 * second submission here is somebody wondering whether the first one worked.
 */
export function SignUpForm() {
  const [state, act, pending] = useActionState<SignUpState, FormData>(
    createAccount,
    {},
  );

  if (state.done) {
    return (
      <Panel tone="done" role="status" className="mt-8">
        <p className="text-lg font-bold">Now sign in with that number</p>
        {/*
          NOT "account created". `POST /auth/signup` answers identically for a
          number that already has an account — deliberately, so it cannot be
          used to check whether a phone belongs to a Yuvoy operator — which
          means that sentence would be false for some of the people reading
          it. What IS true either way is the next step.
        */}
        <p className="text-forest/80 mt-2 font-mono text-sm">
          {state.done.phone}
        </p>
        <p className="text-forest/80 mt-3 text-sm">
          Ask for a sign-in code with that number. That is the next step whether
          this is a brand-new account or one you already had.
        </p>
        <ButtonLink href="/sign-in" className="mt-5">
          Go to sign in
        </ButtonLink>
      </Panel>
    );
  }

  const was = state.values;
  /*
    Remounted per attempt so the uncontrolled inputs re-read `defaultValue`.
    React resets a form when its action completes and `defaultValue` alone
    does not re-apply without a remount — so without the key, a refusal would
    hand back the values and the fields would still come up empty.
  */
  return (
    <form key={state.attempt ?? 0} action={act} className="mt-8 space-y-5">
      <div>
        <label htmlFor="businessName" className="label text-forest/75">
          Your business name
        </label>
        <input
          id="businessName"
          name="businessName"
          defaultValue={was?.businessName ?? ""}
          autoFocus={!state.field || state.field === "businessName"}
          type="text"
          autoComplete="organization"
          required
          maxLength={120}
          placeholder="Reef Divers Havelock"
          aria-invalid={state.field === "businessName" || undefined}
          className={inputClass("mt-2")}
        />
        {/*
          "What travellers will see" — and nothing about the name being
          claimed or checked. Two businesses may share a name in this system,
          so a screen implying otherwise would be making a promise the API
          does not keep.
        */}
        <p className="text-forest/70 mt-2 text-sm">What travellers will see.</p>
      </div>

      <div>
        <label htmlFor="name" className="label text-forest/75">
          Your name
        </label>
        <input
          id="name"
          name="name"
          defaultValue={was?.name ?? ""}
          autoFocus={state.field === "name"}
          type="text"
          autoComplete="name"
          required
          maxLength={120}
          placeholder="Priya Raut"
          aria-invalid={state.field === "name" || undefined}
          className={inputClass("mt-2")}
        />
        <p className="text-forest/70 mt-2 text-sm">
          You will be the owner on this account.
        </p>
      </div>

      <div>
        <label htmlFor="phone" className="label text-forest/75">
          Your phone number
        </label>
        <input
          id="phone"
          name="phone"
          defaultValue={was?.phone ?? ""}
          autoFocus={state.field === "phone"}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          required
          placeholder="+91 90000 00101"
          aria-invalid={state.field === "phone" || undefined}
          className={inputClass("mt-2 text-lg")}
        />
        <p className="text-forest/70 mt-2 text-sm">
          This is what you will sign in with. Include the country code.
        </p>
      </div>

      <div>
        <label htmlFor="email" className="label text-forest/75">
          Email <span className="text-forest/70">(optional)</span>
        </label>
        <input
          id="email"
          name="email"
          defaultValue={was?.email ?? ""}
          autoFocus={state.field === "email"}
          /*
            `text` with an email keyboard, NOT `type="email"`.

            Native validation blocks the submit and shows a browser tooltip,
            so our own message — "leave it blank if unsure", which is the part
            that matters, because this field is optional — would never be
            seen. The same call the capacity screen makes about `min`: the
            server and the schema are the authority, and the operator gets a
            sentence written for them rather than one written by the browser.
          */
          type="text"
          inputMode="email"
          autoComplete="email"
          maxLength={254}
          placeholder="you@yourbusiness.in"
          aria-invalid={state.field === "email" || undefined}
          className={inputClass("mt-2")}
        />
        <p className="text-forest/70 mt-2 text-sm">
          Only if you have one. Everything works without it.
        </p>
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending}>
        {pending ? "Working…" : "Create the account"}
      </Button>

      <p className="border-cream-line text-forest/70 border-t pt-5 text-sm">
        Already have an account?{" "}
        <Link
          href="/sign-in"
          className="text-terra-deep tap-target font-bold underline underline-offset-4"
        >
          Sign in
        </Link>
        .
      </p>
    </form>
  );
}
