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
          */}
          <p className="text-forest/70 mt-2 text-sm">
            For {formatE164(state.phone ?? "")}. It lasts a few minutes.
          </p>
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
            The other door, for an operator who is holding a code already.

            Yuvoy staff can issue one out of band — the hedge for somebody
            whose phone is gone (yuvoy-api#59). That operator must not be made
            to press "Send me a code": it messages a phone they do not have,
            and if issuing a code supersedes an outstanding one it destroys the
            code they are holding, at the moment they are using it.

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
            to the code without messaging your phone.
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
