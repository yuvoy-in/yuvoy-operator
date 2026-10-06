"use client";

import { useActionState, useRef, useState } from "react";
import { fileCredential, type CredentialState } from "./actions";
import {
  CREDENTIAL_TYPES,
  credentialTypeLabel,
  type CredentialType,
} from "@/lib/profile/credentials";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useChangedBeforeHydration } from "@/components/ui/use-changed-before-hydration";
import { Panel } from "@/components/ui/panel";
import { sendForm } from "@/lib/actions/send-form";

/**
 * Sending Yuvoy a document.
 *
 * ## The one thing this screen must never say
 *
 * **Verified.** "Nothing filed here is ever verified. The state is fixed
 * server-side … a self-service path to `verified` would make the credential
 * gate decorative." An operator who files an insurance certificate and reads
 * "verified" will plan a season on it and find out at a cancelled booking.
 *
 * So the success state says *with us*, and says who moves next.
 *
 * ## Why filing twice is worth warning about
 *
 * "Sending the same kind twice replaces the earlier pending one rather than
 * stacking beside it: two pending rows for one document is a queue of
 * duplicates for whoever checks them." Replacing is the right behaviour and it
 * is also a way to lose a document that was already in the queue, so the form
 * names the kind it is about to replace rather than leaving it to be
 * discovered.
 */
export function CredentialForm({
  suggested,
  pendingTypes,
}: {
  /** Read off what the account is actually blocked on. May be null. */
  suggested: CredentialType | null;
  /** Kinds already with us, so the form can say what a resend replaces. */
  pendingTypes: readonly string[];
}) {
  const [state, act, pending] = useActionState(
    sendForm<CredentialState>(fileCredential, () => ({
      message: "No signal. Nothing was sent. We have not got it yet.",
    })),
    {},
  );
  const typed = state.typed;
  const [type, setType] = useState<string>(suggested ?? "");
  // Chosen before the page hydrated: its hint and warning follow it.
  const typeField = useRef<HTMLSelectElement>(null);
  useChangedBeforeHydration(typeField, ([field]) => setType(field.value));

  if (state.sent) {
    return (
      <Panel tone="done" role="status">
        <p className="text-base font-bold text-balance">
          {credentialTypeLabel(state.sent.type)} is with us
        </p>
        {/*
          Not "verified", and not "done". Somebody at Yuvoy has to look at it,
          and the operator is now waiting on us rather than the other way
          round — which is the distinction `waitingOn` exists to make.
        */}
        <p className="text-forest/80 leading-body mt-2 text-sm text-pretty">
          Somebody here will check it. Nothing about your account changes until
          they have, and you will see it move on this screen.
        </p>
      </Panel>
    );
  }

  const chosen = CREDENTIAL_TYPES.find((c) => c.value === type);
  const replaces = type && pendingTypes.includes(type);

  return (
    <Panel>
      <h2 className="font-display tracking-display leading-display text-2xl text-balance">
        Send us a document
      </h2>

      {/*
        Remounted per refusal (`sendForm`), onto what was typed. Which
        document it is lives in state, and a reset in place showed "Choose
        one" over the hint and the warning for the kind still chosen, while a
        refused expiry date took the issuer, the number and the notes with it.
      */}
      <form key={state.attempt ?? 0} action={act} className="mt-5 space-y-5">
        <div>
          <label htmlFor="cred-type" className="label text-forest/75">
            Which document
          </label>
          <select
            ref={typeField}
            id="cred-type"
            name="type"
            required
            value={type}
            onChange={(e) => setType(e.target.value)}
            className={inputClass("mt-2")}
          >
            <option value="">Choose one</option>
            {CREDENTIAL_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {chosen ? (
            <p className="text-forest/70 mt-1.5 text-xs">{chosen.hint}</p>
          ) : null}
          {replaces ? (
            /*
              Said before the tap. Replacing is correct — it stops a queue of
              duplicates — and it is also how somebody loses a document they
              sent last week without meaning to.
            */
            <p className="text-terra-deep mt-2 text-sm font-bold">
              We already have one of these waiting. Sending another replaces it.
            </p>
          ) : null}
        </div>

        <div>
          <label htmlFor="cred-issuer" className="label text-forest/75">
            Who issued it
          </label>
          <input
            id="cred-issuer"
            name="issuer"
            defaultValue={typed?.issuer ?? ""}
            className={inputClass("mt-2")}
            placeholder="Directorate of Tourism, PADI, your insurer…"
          />
        </div>

        <div>
          <label htmlFor="cred-identifier" className="label text-forest/75">
            Its number
          </label>
          <input
            id="cred-identifier"
            name="identifier"
            defaultValue={typed?.identifier ?? ""}
            className={inputClass("mt-2")}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="cred-issued" className="label text-forest/75">
              Issued on
            </label>
            <input
              id="cred-issued"
              name="issuedOn"
              type="date"
              defaultValue={typed?.issuedOn ?? ""}
              className={inputClass("mt-2")}
            />
          </div>
          <div>
            <label htmlFor="cred-expires" className="label text-forest/75">
              Expires on
            </label>
            <input
              id="cred-expires"
              name="expiresOn"
              type="date"
              defaultValue={typed?.expiresOn ?? ""}
              className={inputClass("mt-2")}
              aria-invalid={state.field === "expiresOn" || undefined}
              aria-describedby="cred-expires-hint"
            />
            {/*
              The field that decides whether the account keeps selling. "An
              expired mandatory credential stops sales, evaluated at the
              departure's start instant."
            */}
            <p id="cred-expires-hint" className="text-forest/70 mt-1.5 text-xs">
              An expired document stops your departures selling.
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="cred-notes" className="label text-forest/75">
            Anything we should know
          </label>
          <Textarea
            id="cred-notes"
            name="notes"
            rows={3}
            defaultValue={typed?.notes ?? ""}
            className={inputClass("mt-2 h-auto py-3")}
          />
        </div>

        {state.message ? (
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {state.message}
          </p>
        ) : null}

        <Button
          type="submit"
          pending={pending}
          pendingLabel="Sending"
          variant="primary"
        >
          Send it to us
        </Button>
      </form>
    </Panel>
  );
}
