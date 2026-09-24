"use client";

import { useActionState, useState } from "react";
import {
  changeBank,
  requestStepUp,
  type BankState,
  type StepUpState,
} from "./actions";
import { maskAccount } from "@/lib/account/bank";
import { SUPPORT_PHONE } from "@/lib/site/contact";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Changing where the money goes.
 *
 * The whole design is deliberately slow, and the form says what raising a
 * change does before the tap: nothing today, then two clocks, stoppable
 * throughout. WHY it is slow is an answer in Help (yuvoy-operator#80 t4).
 *
 * ## Empty, always
 *
 * yuvoy-operator#87 s14: "The form arrives half filled: IFSC shows
 * HDFC0001234, the account number is empty." Nothing was filled: the IFSC's
 * placeholder was an example IFSC, which on a phone in the sun is
 * indistinguishable from a saved one. So there is no placeholder, the shape
 * is said under the field instead, and what IS on file is shown as text above
 * the form, never as values in it.
 *
 * Only an owner of a business that is not suspended is shown this form; the
 * screen says so to everybody else before they reach it.
 */
export function BankForm({
  onCancel,
  autoFocus = false,
}: {
  /** Closes the form when an account is already on file: "Keep this account". */
  onCancel?: () => void;
  /**
   * Put the caret in the first field. Set when the form was opened by tapping
   * Change, which is a request to type; never on arrival, where a keyboard
   * opening by itself would cover the account on file.
   */
  autoFocus?: boolean;
}) {
  const [step, setStep] = useState<StepUpState>({});
  const [sending, setSending] = useState(false);
  const [account, setAccount] = useState("");
  const [state, act, pending] = useActionState<BankState, FormData>(
    changeBank,
    {},
  );

  return (
    <form action={act} className="space-y-5">
      <div>
        <label htmlFor="accountHolder" className="label text-forest/75">
          Name on the account
        </label>
        <input
          id="accountHolder"
          name="accountHolder"
          type="text"
          autoComplete="off"
          autoFocus={autoFocus}
          required
          className={inputClass("mt-2")}
        />
      </div>

      <div>
        <label htmlFor="accountNumber" className="label text-forest/75">
          Account number
        </label>
        <input
          id="accountNumber"
          name="accountNumber"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          required
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          className={inputClass("mt-2 font-mono")}
        />
        {/*
          Shown before sending, because it is what will actually be stored.
          Only the last four digits are kept: nothing in this service pays
          anybody, so holding the full number would be a liability with no
          matching capability. The rest is confirmed by a person, on a call,
          which is what the sentence says rather than "out of band", a phrase
          nobody outside software uses (op#87 s14).
        */}
        <p className="text-forest/70 mt-1.5 text-xs">
          We store the last four digits only
          {account.replace(/\D/g, "").length >= 4
            ? `: ${maskAccount(account)}`
            : ""}
          . We will call you to confirm the account number.
        </p>
      </div>

      <div>
        <label htmlFor="ifsc" className="label text-forest/75">
          IFSC
        </label>
        <input
          id="ifsc"
          name="ifsc"
          type="text"
          autoComplete="off"
          required
          aria-describedby="ifsc-hint"
          className={inputClass("mt-2 font-mono uppercase")}
        />
        {/*
          The shape, said beside the field rather than typed into it: a
          placeholder IFSC read as a saved one (op#87 s14). The fifth character
          is the one people get wrong, a reserved zero that reads as an O.
        */}
        <p id="ifsc-hint" className="text-forest/70 mt-1.5 text-xs">
          11 characters. The fifth is always a zero.
        </p>
      </div>

      <div>
        <label htmlFor="bankName" className="label text-forest/75">
          Bank (optional)
        </label>
        <input
          id="bankName"
          name="bankName"
          type="text"
          autoComplete="off"
          className={inputClass("mt-2")}
        />
      </div>

      {/* ------------------------------------------------------- step up -- */}
      <Panel tone="outline" className="p-4">
        {/*
          It said "A code goes to the owner's phone", and none ever has: there
          is no WhatsApp sender, and since yuvoy-api 67e3213 the step-up code
          goes to the owner's email address (yuvoy-operator#91). Who it goes to
          is the part that matters, and is unchanged: an owner, whoever asks.
        */}
        <p className="text-sm font-bold">
          A code is emailed to the owner, whoever asks
        </p>

        {step.sent ? (
          <>
            <label htmlFor="code" className="label text-forest/75 mt-4 block">
              The code
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              className={inputClass("mt-2 font-mono text-2xl tracking-[0.4em]")}
            />
            <p className="text-forest/70 mt-1.5 text-xs">
              It lasts ten minutes.
            </p>
            {step.devCode ? (
              <p className="rounded-card border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
                Development build: the code is{" "}
                <strong className="font-mono">{step.devCode}</strong>.
              </p>
            ) : null}
          </>
        ) : step.nobodyToSendTo ? (
          /*
            No code field, because there is no code and there is not going to be
            one (yuvoy-operator#46 item 4).

            `sent: false` has two causes and the response names neither. A
            business whose first person runs it has no owner (D15): "the code
            goes to no number". And an owner with no email address with us is
            one nothing can reach while there is no phone sender, since the
            code travels by email (yuvoy-api 67e3213, yuvoy-operator#91). The
            sentence used to name only the first, which told an owner-run
            business that "an owner has to join". So it names both, and the one
            way forward that covers both.

            This screen used to draw the field anyway, because the action
            returned `sent: true` whatever the API said, so somebody at such a
            business typed into a box waiting for a message nobody sent.
          */
          <p className="text-terra-deep mt-4 text-sm font-bold">
            No code was sent. We have no way to reach an owner: there is no
            owner on this account yet, or the owner has no email address with
            us. Call us on {SUPPORT_PHONE}.
          </p>
        ) : (
          <Button
            disabled={sending}
            onClick={async () => {
              setSending(true);
              setStep(await requestStepUp());
              setSending(false);
            }}
            variant="outline"
            className="mt-4"
          >
            {sending ? "Sending…" : "Send the code"}
          </Button>
        )}

        {step.message ? (
          <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
            {step.message}
          </p>
        ) : null}
      </Panel>

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      {/*
        Said before the tap, which is what it is for: the consequence of
        raising a change. "The owner is messaged immediately" was the claim
        here, and it is not true: the bank-change warning is phone only, by
        design, and with no phone sender it is suppressed (yuvoy-operator#91).
        What stands is the window and the brake on this screen, so that is
        what it promises.
      */}
      <p className="text-forest/70 text-xs">
        Raising it changes nothing today. For 24 hours an owner or an admin can
        stop it from this screen; a person at Yuvoy then reviews it; and it goes
        live 24 hours after that, still stoppable the whole time.
      </p>

      <div className="flex flex-col gap-2">
        <Button type="submit" disabled={pending || !step.sent}>
          {pending ? "Raising…" : "Raise the change"}
        </Button>
        {onCancel ? (
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Keep this account
          </Button>
        ) : null}
      </div>
    </form>
  );
}
