"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  checkClaimCode,
  sendClaimCode,
  type EmailStepState,
} from "@/app/claim/actions";
import { Button } from "@/components/ui/button";
import { fieldLabelClass, inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { useChangedBeforeHydration } from "@/components/ui/use-changed-before-hydration";
import { sendForm } from "@/lib/actions/send-form";
import { claimUnsent, emailFieldLabel } from "@/lib/claims/claims";
import {
  CHECK_CODE,
  CLAIM_CODE,
  CODE_FIELD_LABEL,
  EMAIL_CHECKED_LINE,
  EMAIL_SENT_LINE,
  SEND_CODE,
} from "@/lib/claims/words";

/**
 * The email proof, two steps on one waiting `email_domain` claim
 * (yuvoy-operator#388, the phone's `email-steps.tsx`): an address at the
 * listing's website gets a six-digit code, and the code is typed back. Shown
 * after the claim is made and again from the claims list while the code is
 * still needed. Both steps stay on screen, so a code that came after the
 * screen was left can be checked without a new one.
 *
 * The send answers `204` whether or not a code went (the hour's ceiling), so
 * the line after it never promises one. A right code ends the business's
 * part; a person still decides. A claim decided or withdrawn meanwhile
 * (`409 conflict` `not_waiting`) reads the page again.
 *
 * Both fields are controlled and each form is sent from `onSubmit`, not as a
 * form action: React resets a form after its action, and a refused code would
 * take the address with it.
 */
export function EmailSteps({
  claimId,
  websiteHost,
}: {
  claimId: string;
  websiteHost: string | null;
}) {
  const router = useRouter();
  const ids = useId();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const steps = useRef<HTMLDivElement>(null);
  // The claims list draws these on the server: an address or a code typed
  // before the page hydrated reaches the state, as `onChange` would have.
  useChangedBeforeHydration(steps, (changed) => {
    for (const field of changed) {
      if (field.name === "email") setEmail(field.value);
      if (field.name === "code") setCode(digitsOnly(field.value));
    }
  });
  const [sent, send, sending] = useActionState(
    sendForm<EmailStepState>(sendClaimCode, () => claimUnsent("send")),
    {},
  );
  const [checked, check, checking] = useActionState(
    sendForm<EmailStepState>(checkClaimCode, () => claimUnsent("check")),
    {},
  );

  // A claim decided or withdrawn under the screen: what is on it is out of
  // date. Read again only with a signal, or Next loads the browser's "no
  // internet" page in place of the portal.
  useEffect(() => {
    if (!sent.readAgain && !checked.readAgain) return;
    if (navigator.onLine) router.refresh();
  }, [sent, checked, router]);

  const submit =
    (act: (form: FormData) => void, busy: boolean, ready: boolean) =>
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (busy || !ready) return;
      const form = new FormData(e.currentTarget);
      startTransition(() => act(form));
    };

  if (checked.done) {
    return (
      <Panel tone="done" role="status" className="mt-4">
        <p className="text-base font-bold">{EMAIL_CHECKED_LINE}</p>
      </Panel>
    );
  }

  const address = email.trim();
  const sendFailed = Boolean(sent.message) && !sending;
  const checkFailed = Boolean(checked.message) && !checking;

  return (
    <div
      ref={steps}
      className="mt-4 flex flex-col gap-6"
      data-testid="claim-email"
    >
      <form
        onSubmit={submit(send, sending, address !== "")}
        noValidate
        aria-busy={sending}
      >
        <input type="hidden" name="claimId" value={claimId} />
        <label htmlFor={`${ids}-email`} className={fieldLabelClass()}>
          {emailFieldLabel(websiteHost)}
        </label>
        <input
          id={`${ids}-email`}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={sendFailed}
          className={inputClass("mt-2")}
        />
        <Button
          type="submit"
          variant="secondary"
          className="mt-3"
          pending={sending}
          pendingLabel="Sending"
          disabled={address === ""}
        >
          {SEND_CODE}
        </Button>
        {/* Mounted from the start, so a screen reader hears it arrive. */}
        <p
          role="status"
          className={
            sent.done && !sending
              ? "text-forest/80 leading-body mt-3 text-sm text-pretty"
              : "sr-only"
          }
        >
          {sent.done && !sending ? EMAIL_SENT_LINE : ""}
        </p>
        {sendFailed ? (
          <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
            {sent.message}
          </p>
        ) : null}
      </form>

      <form
        onSubmit={submit(check, checking, CLAIM_CODE.test(code))}
        noValidate
        aria-busy={checking}
      >
        <input type="hidden" name="claimId" value={claimId} />
        <label htmlFor={`${ids}-code`} className={fieldLabelClass()}>
          {CODE_FIELD_LABEL}
        </label>
        <input
          id={`${ids}-code`}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(digitsOnly(e.target.value))}
          aria-invalid={checkFailed}
          className={inputClass("mt-2 tabular-nums")}
        />
        <Button
          type="submit"
          className="mt-3"
          pending={checking}
          pendingLabel="Checking"
          disabled={!CLAIM_CODE.test(code)}
        >
          {CHECK_CODE}
        </Button>
        {checkFailed ? (
          <p role="alert" className="text-terra-deep mt-3 text-sm font-bold">
            {checked.message}
          </p>
        ) : null}
      </form>
    </div>
  );
}

/** What the code field keeps: digits, six at most. */
function digitsOnly(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6);
}
