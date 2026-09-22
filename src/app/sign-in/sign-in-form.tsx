"use client";

import { useActionState, useState } from "react";
import {
  requestCode,
  submitCode,
  enterExistingCode,
  type SignInState,
} from "./actions";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { PhoneField } from "@/components/ui/phone-field";
import { formatE164 } from "@/lib/auth/phone";
import { SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/site/contact";

/**
 * Where a code the operator asks for goes, said beside the button that asks.
 *
 * yuvoy-operator#91. The screen used to say nothing about the channel and let
 * its one hint do the implying: "It takes you straight to the code without
 * messaging your phone" told every operator that pressing the other button
 * messages their phone. It did not. There has never been a WhatsApp sender
 * (yuvoy-api#68), and since yuvoy-api 67e3213 every code goes to the email
 * address on the account instead, verified in production on 20 September.
 *
 * `POST /auth/otp` does not say which channel carried a particular code, and
 * cannot: it answers identically for a number we know and one we do not. So
 * this is said as where codes GO, which is true of every request, and never as
 * a claim that this one arrived. The operator with no email on the account is
 * the one who would otherwise wait for nothing, so the same line gives them
 * the way in that exists: a code from a person at Yuvoy (yuvoy-api#59), typed
 * in through "I already have a code".
 */
function WhereTheCodeGoes({ id }: { id: string }) {
  return (
    <p id={id} className="text-forest/70 text-xs">
      We email the code to the address on your account. No email on it? Call us
      on{" "}
      <a
        href={SUPPORT_PHONE_HREF}
        className="text-terra-deep tap-target font-bold whitespace-nowrap underline underline-offset-4"
      >
        {SUPPORT_PHONE}
      </a>{" "}
      and we will give you one.
    </p>
  );
}

/**
 * Two steps in one form, driven entirely by Server Actions.
 *
 * There is no fetch here and no token here. `useActionState` posts to the
 * action, the action talks to `/operator/v1` on the server, and the session
 * comes back as an httpOnly cookie this component cannot read — which is the
 * whole point of the portal's architecture and not an inconvenience to work
 * around later.
 */
export function SignInForm({ next }: { next?: string | null }) {
  const [state, act, pending] = useActionState<SignInState, FormData>(
    async (prev, form) => {
      if (prev.step === "code") return submitCode(prev, form);
      /*
        An operator who already holds a Yuvoy-issued code goes straight to the
        code field rather than asking for one to be sent — see
        `enterExistingCode`. Dispatched on an intent field rather than a second
        form, so both buttons submit the same phone number.
      */
      return form.get("intent") === "have-code"
        ? enterExistingCode(prev, form)
        : requestCode(prev, form);
    },
    { step: "phone" },
  );

  /*
    Both buttons below send the number, so both wait for a whole one.

    This lives here rather than inside `PhoneField` because the field cannot
    know how many buttons depend on it. It resets with the form's `key`, which
    is also what re-seeds the field after a refusal: React resets a form once
    its action completes, so a remount is what puts the number the operator
    typed back in front of them instead of an empty box. A `complete` that
    survived that remount would leave a live button over a blank field.
  */
  const [complete, setComplete] = useState(false);

  return (
    <form key={state.attempt ?? 0} action={act} className="mt-8 space-y-5">
      {/*
        Carried through both steps, because the code step is a new submission
        and the URL is not re-read. Validated again in the action: a hidden
        input is client-controlled, and this one decides a redirect.
      */}
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {state.step === "phone" ? (
        <PhoneField
          defaultValue={state.typed ?? ""}
          autoFocus
          invalid={Boolean(state.message)}
          onCompleteChange={setComplete}
          hint="The number Yuvoy has for your business."
        />
      ) : (
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
            "For", not "sent to". If Yuvoy issued this code by another route,
            nothing was sent anywhere — but the code still belongs to that
            number, which is the fact worth showing: it is how somebody catches
            a digit they mistyped on the previous step.

            Where to look is said only on the path that asked for a code. The
            operator who came through "I already have a code" is holding it
            already, and pointing them at an inbox would send them looking for
            a message nobody wrote.
          */}
          <p className="text-forest/70 mt-2 text-sm">
            For {formatE164(state.phone ?? "")}. It lasts a few minutes.
          </p>
          {state.existing ? null : (
            <div className="mt-2">
              <WhereTheCodeGoes id="sign-in-where" />
            </div>
          )}
          {state.devCode ? (
            <p className="rounded-card border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
              Development build: the code is{" "}
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

      <Button
        type="submit"
        disabled={pending || (state.step === "phone" && !complete)}
        aria-describedby={state.step === "phone" ? "sign-in-where" : undefined}
      >
        {pending
          ? "Working…"
          : state.step === "code"
            ? "Sign in"
            : "Send me a code"}
      </Button>

      {state.step === "phone" ? (
        <>
          {/*
            Directly under the button it describes, and tied to it with
            `aria-describedby`, so "Send me a code" is announced with where the
            code will go. See `WhereTheCodeGoes`.
          */}
          <WhereTheCodeGoes id="sign-in-where" />

          {/*
            The other door, for an operator who is holding a code already.

            Yuvoy staff can issue one out of band — the hedge for somebody
            whose phone is gone, or whose account has no email to send a code
            to (yuvoy-api#59). That operator must not be made to press "Send me
            a code": if issuing a code supersedes an outstanding one it destroys
            the code they are holding, at the moment they are using it.

            A submit rather than a link, so it carries the number they already
            typed. `name` + `value` on a button is what puts `intent` in the
            form data — the same pattern the request queue uses.
          */}
          <Button
            type="submit"
            name="intent"
            value="have-code"
            variant="secondary"
            disabled={pending || !complete}
          >
            I already have a code
          </Button>
          <p className="text-forest/70 text-xs">
            If somebody at Yuvoy gave you one, use this. It takes you straight
            to the code without asking for a new one.
          </p>
        </>
      ) : null}

      {state.existing ? (
        /*
          Nothing was sent, so the screen does not imply anything was. It also
          does not say what channel the code came from — it has not been told,
          and that is deliberate. See the sign-in copy rule in `pnpm qa`.
        */
        <p className="text-forest/70 text-xs">
          Enter the code you were given. We have not messaged you.
        </p>
      ) : null}
    </form>
  );
}
