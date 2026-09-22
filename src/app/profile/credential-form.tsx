"use client";

import { useActionState, useState } from "react";
import { fileCredential, type CredentialState } from "./actions";
import {
  CREDENTIAL_TYPES,
  credentialTypeLabel,
  type CredentialType,
} from "@/lib/profile/credentials";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

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
  const [state, act, pending] = useActionState<CredentialState, FormData>(
    fileCredential,
    {},
  );
  const [type, setType] = useState<string>(suggested ?? "");

  if (state.sent) {
    return (
      <Panel tone="done" role="status">
        <p className="text-base font-bold">
          {credentialTypeLabel(state.sent.type)} is with us
        </p>
        {/*
          Not "verified", and not "done". Somebody at Yuvoy has to look at it,
          and the operator is now waiting on us rather than the other way
          round — which is the distinction `waitingOn` exists to make.
        */}
        <p className="text-forest/80 mt-2 text-sm">
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
      <h2 className="font-display text-2xl">Send us a document</h2>

      <form action={act} className="mt-5 space-y-5">
        <div>
          <label htmlFor="cred-type" className="label text-forest/75">
            Which document
          </label>
          <select
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
          <textarea
            id="cred-notes"
            name="notes"
            rows={3}
            className={inputClass("mt-2")}
          />
        </div>

        {state.message ? (
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Sending…" : "Send it to us"}
        </Button>
      </form>
    </Panel>
  );
}
