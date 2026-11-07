"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createClaim, type CreateClaimState } from "./actions";
import { EmailSteps } from "@/components/claims/email-steps";
import { ProofCode } from "@/components/claims/proof-code";
import { Button, ButtonLink } from "@/components/ui/button";
import { choiceClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";
import { useChangedBeforeHydration } from "@/components/ui/use-changed-before-hydration";
import { sendForm } from "@/lib/actions/send-form";
import { cn } from "@/lib/cn";
import {
  claimOutcome,
  claimUnsent,
  type ClaimPreview,
  type ListingClaim,
} from "@/lib/claims/claims";
import {
  ASK_TO_CLAIM,
  CLAIM_DECIDE_LINE,
  CLAIM_NOT_OPEN_LINE,
  CLAIM_TITLE,
  NO_WEBSITE_LINE,
  PROOF_OPTIONS,
  SEE_CLAIMS_LINK,
  type ClaimProofMethod,
} from "@/lib/claims/words";

/**
 * The claim itself (yuvoy-operator#388, the phone's `claim-screen.tsx` below
 * its reads): the listing's name, then for an OWNER or ADMIN the four proofs
 * and "Ask to claim". MANAGER and STAFF are told who can (`roleLine`, from the
 * session's roles; the API still answers `403 forbidden`, shown in its words).
 * A listing with no website has the email proof greyed before any tap, and so
 * does a `400 no_website` from the claim itself. The `201` says what comes
 * next by the proof chosen.
 *
 * "Ask to claim" sends one claim however fast it is tapped: a ref is set
 * before the request goes, so a second tap in the same frame, before React
 * has marked the form pending, sends nothing. The choice is controlled and the
 * form is sent from `onSubmit`, so a refusal never resets it.
 */
export function ClaimForm({
  slug,
  listing,
  roleLine,
}: {
  slug: string;
  listing: ClaimPreview;
  /** Set for a login that may not claim (MANAGER, STAFF): who can, instead of the proofs. */
  roleLine: string | null;
}) {
  const [state, act, pending] = useActionState(
    sendForm<CreateClaimState>(createClaim, () => claimUnsent("create")),
    {},
  );
  const [method, setMethod] = useState<ClaimProofMethod | null>(null);
  const [noWebsite, setNoWebsite] = useState(false);
  const sending = useRef(false);
  const proofs = useRef<HTMLFieldSetElement>(null);
  // A proof picked before the page hydrated reaches the state.
  useChangedBeforeHydration(proofs, ([chosen]) => {
    const picked = PROOF_OPTIONS.find((o) => o.method === chosen.value);
    if (picked) setMethod(picked.method);
  });
  const [answered, setAnswered] = useState(state);

  // A `400 no_website` greys the email proof, set while rendering the new
  // answer (not in an effect) so it is drawn in the same pass.
  if (answered !== state) {
    setAnswered(state);
    if (state.noWebsite) {
      setNoWebsite(true);
      setMethod((m) => (m === "email_domain" ? null : m));
    }
  }

  // Every answer frees the guard.
  useEffect(() => {
    sending.current = false;
  }, [state]);

  const heading = (
    <>
      <p className="label text-forest/75">{CLAIM_TITLE}</p>
      <h1
        className="font-display tracking-display leading-display mt-2 text-4xl text-balance break-words"
        data-testid="claim-listing-name"
      >
        {listing.name}
      </h1>
    </>
  );

  if (state.claim) {
    return (
      <>
        {heading}
        <Made
          claim={state.claim}
          websiteHost={state.claim.websiteHost ?? listing.websiteHost}
        />
      </>
    );
  }

  if (!listing.claimable) {
    return (
      <>
        {heading}
        <p
          className="text-forest/80 leading-body mt-6 text-base text-pretty"
          data-testid="claim-not-open"
        >
          {CLAIM_NOT_OPEN_LINE}
        </p>
      </>
    );
  }

  if (roleLine) {
    return (
      <>
        {heading}
        <Panel className="mt-6" data-testid="claim-role-line">
          <p className="leading-body text-base text-pretty">{roleLine}</p>
        </Panel>
      </>
    );
  }

  const noSite = noWebsite || listing.websiteHost === null;
  const refusal = !pending && state.message ? state.message : null;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (sending.current || pending || method === null) return;
    sending.current = true;
    const form = new FormData(e.currentTarget);
    startTransition(() => act(form));
  };

  return (
    <>
      {heading}
      <form onSubmit={submit} noValidate className="mt-6" aria-busy={pending}>
        <input type="hidden" name="slug" value={slug} />
        <fieldset
          ref={proofs}
          className="flex flex-col gap-2"
          data-testid="claim-options"
        >
          {/* The phone names the group by its options alone; a screen reader still hears what it is for. */}
          <legend className="sr-only">Choose how to show it is yours</legend>
          {PROOF_OPTIONS.map((o) => {
            const off = o.method === "email_domain" && noSite;
            const checked = method === o.method;
            return (
              <label
                key={o.method}
                className={choiceClass(
                  checked,
                  cn(off && "cursor-not-allowed opacity-45"),
                )}
                data-testid={`claim-option-${o.method}`}
              >
                <input
                  type="radio"
                  name="proofMethod"
                  value={o.method}
                  checked={checked}
                  disabled={off}
                  onChange={() => setMethod(o.method)}
                  className="accent-terra-deep size-5 shrink-0"
                />
                <span className="flex flex-col gap-1">
                  <span className="text-base font-bold">{o.title}</span>
                  <span className="text-forest/80 leading-body text-sm text-pretty">
                    {o.body}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {noSite ? (
          <p
            className="text-forest/80 leading-body mt-3 text-sm text-pretty"
            data-testid="claim-no-website"
          >
            {NO_WEBSITE_LINE}
          </p>
        ) : null}
        {refusal ? (
          <p
            role="alert"
            className="text-terra-deep mt-3 text-sm font-bold"
            data-testid="claim-error"
          >
            {refusal}
          </p>
        ) : null}
        <Button
          type="submit"
          className="mt-6"
          pending={pending}
          pendingLabel="Sending"
          disabled={method === null}
        >
          {ASK_TO_CLAIM}
        </Button>
      </form>
    </>
  );
}

/** After the `201`, by the proof chosen. */
function Made({
  claim,
  websiteHost,
}: {
  claim: ListingClaim;
  websiteHost: string | null;
}) {
  const outcome = claimOutcome(claim);
  if (outcome.kind === "email") {
    return (
      <div className="mt-6" data-testid="claim-made">
        <EmailSteps claimId={claim.claimId} websiteHost={websiteHost} />
        <SeeClaims />
      </div>
    );
  }
  return (
    <div className="mt-6" data-testid="claim-made">
      {outcome.kind === "code" ? (
        <>
          <h2 className="text-lg font-bold">{outcome.heading}</h2>
          <ProofCode code={outcome.code} />
        </>
      ) : null}
      <p
        className="leading-body mt-4 text-base text-pretty"
        data-testid="claim-next"
      >
        {outcome.body}
      </p>
      <p
        className="text-forest/80 leading-body mt-2 text-base text-pretty"
        data-testid="claim-decide"
      >
        {CLAIM_DECIDE_LINE}
      </p>
      <SeeClaims />
    </div>
  );
}

function SeeClaims() {
  return (
    <ButtonLink
      href="/account/verification"
      variant="outline"
      className="mt-6"
      data-testid="claim-see-claims"
    >
      {SEE_CLAIMS_LINK}
    </ButtonLink>
  );
}
