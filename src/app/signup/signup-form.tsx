"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  createAccount,
  finishSignUp,
  resendCode,
  type SignUpState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { PhoneField } from "@/components/ui/phone-field";
import { formatE164 } from "@/lib/auth/phone";

/**
 * Two steps, one flow, and no bounce to sign in — yuvoy-operator#20.
 *
 * The details form is replaced by the code field rather than sitting above it:
 * a form still on screen beside "enter your code" invites a second submission,
 * and a second submission here is somebody wondering whether the first worked.
 */
export function SignUpForm() {
  const [state, act, pending] = useActionState<SignUpState, FormData>(
    async (prev, form) => {
      if (prev.step === "code") {
        return form.get("intent") === "resend"
          ? resendCode(prev)
          : finishSignUp(prev, form);
      }
      return createAccount(prev, form);
    },
    { step: "details" },
  );
  /** The submit waits for a whole number. See `PhoneField`. */
  const [complete, setComplete] = useState(false);

  if (state.step === "code") {
    return (
      <form action={act} className="mt-8 space-y-5">
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
            className={inputClass("mt-2 font-mono text-2xl tracking-[0.4em]")}
          />
          {/*
            "For", not "sent to" — the same rule `/sign-in` keeps, and `pnpm qa`
            enforces on both. A code may arrive by WhatsApp or be issued by
            Yuvoy out of band (yuvoy-api#59); this screen is never told which,
            so its copy is true of both, unconditionally.

            And NOT "your account is created", which yuvoy-operator#20 asked
            for: `POST /auth/signup` answers identically for a number that
            already has an account, deliberately, so that sentence is false for
            exactly the people we are not allowed to tell apart. "Almost there"
            is true either way.
          */}
          <p className="text-forest/70 mt-2 text-sm">
            Almost there. For {formatE164(state.phone ?? "")}. It lasts a few
            minutes.
          </p>
          {state.devCode ? (
            <p className="rounded-card border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
              Development build: the code is{" "}
              <strong className="font-mono">{state.devCode}</strong>. This never
              appears in production.
            </p>
          ) : null}
        </div>

        {state.message ? (
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending}>
          {pending ? "Working…" : "Finish"}
        </Button>

        {/*
          The account exists by now, so "start again" is not an option that
          means anything — asking for another code is. A submit rather than a
          link, so the phone travels with it.
        */}
        <Button
          type="submit"
          name="intent"
          value="resend"
          variant="secondary"
          disabled={pending}
        >
          Send another code
        </Button>
      </form>
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

      <PhoneField
        defaultValue={was?.phone ?? ""}
        autoFocus={state.field === "phone"}
        invalid={state.field === "phone"}
        onCompleteChange={setComplete}
        hint="This is what you will sign in with."
      />

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

      <Button type="submit" disabled={pending || !complete}>
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
