"use client";

import { useActionState, useState } from "react";
import {
  changeBank,
  requestStepUp,
  type BankState,
  type StepUpState,
} from "./actions";
import { maskAccount } from "@/lib/account/bank";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * Changing where the money goes.
 *
 * The whole design is deliberately slow, and this form's job is to **explain
 * that rather than apologise for it**. An operator who understands why it
 * takes 48 hours does not phone us on hour two; one who does not, does.
 */
export function BankForm({ canRaise }: { canRaise: boolean }) {
  const [step, setStep] = useState<StepUpState>({});
  const [sending, setSending] = useState(false);
  const [account, setAccount] = useState("");
  const [state, act, pending] = useActionState<BankState, FormData>(
    changeBank,
    {},
  );

  if (!canRaise) {
    return (
      <p className="text-forest/70 text-sm">
        Only the owner can change where the money goes. That is not a
        permissions quirk — a stolen login plus one convincing phone call is
        otherwise enough to redirect a season&rsquo;s takings.
      </p>
    );
  }

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
          Only the last four digits are kept — nothing in this service pays
          anybody, so holding the full number would be a liability with no
          matching capability.
        */}
        <p className="text-forest/70 mt-1.5 text-xs">
          We store the last four digits only
          {account.replace(/\D/g, "").length >= 4
            ? ` — ${maskAccount(account)}`
            : ""}
          . A person confirms the rest with you out of band.
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
          placeholder="HDFC0001234"
          className={inputClass("mt-2 font-mono uppercase")}
        />
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
        <p className="text-sm font-bold">
          A code goes to the owner&rsquo;s phone
        </p>
        <p className="text-forest/80 mt-1.5 text-sm">
          Whoever asks. A manager who requested this will not receive it — that
          is the point of sending it to the owner.
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
              It lasts ten minutes — long enough for a bad phone keyboard, short
              enough that a session left open at a dive shop is not still
              elevated after lunch.
            </p>
            {step.devCode ? (
              <p className="rounded-card border-terra-deep text-terra-deep mt-3 border border-dashed p-3 text-sm">
                Development build — the code is{" "}
                <strong className="font-mono">{step.devCode}</strong>.
              </p>
            ) : null}
          </>
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

      <Button type="submit" disabled={pending || !step.sent}>
        {pending ? "Raising…" : "Raise the change"}
      </Button>

      <p className="text-forest/70 text-xs">
        Raising it changes nothing today. The owner is messaged immediately and
        can stop it for 24 hours; a person at Yuvoy then reviews it; and it goes
        live 24 hours after that, still stoppable the whole time.
      </p>
    </form>
  );
}
