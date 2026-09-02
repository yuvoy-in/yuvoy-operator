"use client";

import { useActionState, useEffect, useState } from "react";
import { attestRights, type AttestState } from "./actions";
import { Submitted } from "./submitted";
import {
  RIGHTS_STATEMENT,
  RIGHTS_TYPES,
  STATEMENT_VERSION,
  sha256Hex,
} from "@/lib/media/rights";

/**
 * The last step, and the one the whole screen exists to get right.
 *
 * **Attesting is not publishing**, and the contract asks us to say so: "a
 * reviewer checks it afterwards, and only their approval produces the verified
 * rights record the database requires before a clip can appear anywhere. Say so
 * in the UI — operators reasonably assume attesting is the last step."
 *
 * The hash is computed here, in the browser, from the exact string rendered
 * below. Not on the server, and not from a copy: `statementSha256` is "the hash
 * of the statement **as it was rendered to the operator**", and a hash produced
 * anywhere else is a hash of what somebody *believes* was rendered — which is
 * the substitution the field exists to prevent.
 */
export function RightsForm({ mediaAssetId }: { mediaAssetId: string }) {
  const [state, act, pending] = useActionState<AttestState, FormData>(
    attestRights,
    {},
  );
  const [hash, setHash] = useState("");
  const [rightsType, setRightsType] = useState<string>("owned");

  useEffect(() => {
    void sha256Hex(RIGHTS_STATEMENT).then(setHash);
  }, []);

  if (state.done) {
    // The success panel owns the takedown, so it holds its own action state.
    return (
      <Submitted
        mediaAssetId={mediaAssetId}
        attestationNote={state.done.note}
      />
    );
  }

  return (
    <form action={act} className="space-y-6">
      <input type="hidden" name="mediaAssetId" value={mediaAssetId} />
      <input type="hidden" name="statementVersion" value={STATEMENT_VERSION} />
      <input type="hidden" name="statementSha256" value={hash} />

      <div>
        <p className="text-base font-bold">Your clip is uploaded</p>
        <p className="text-forest/70 mt-1 text-sm">
          One thing left: tell us it is yours to give us.
        </p>
      </div>

      {/*
        Rendered verbatim from the constant that is hashed. Never reflowed,
        never paraphrased in JSX — the two must be the same bytes or the
        attestation is a claim about words nobody saw.
      */}
      <blockquote className="rounded-edge border-cream-line bg-cream-deep border p-5 text-sm whitespace-pre-line">
        {RIGHTS_STATEMENT}
      </blockquote>

      <fieldset>
        <legend className="label text-forest/75">
          Where did this footage come from?
        </legend>
        <div className="mt-2 space-y-2">
          {RIGHTS_TYPES.map((type) => (
            <label
              key={type.code}
              className="rounded-edge border-cream-line bg-cream flex cursor-pointer items-start gap-3 border p-3"
            >
              <input
                type="radio"
                name="rightsType"
                value={type.code}
                required
                checked={rightsType === type.code}
                onChange={() => setRightsType(type.code)}
                className="mt-0.5 size-5 shrink-0"
              />
              <span>
                <span className="block text-sm font-bold">{type.label}</span>
                <span className="text-forest/80 block text-xs">
                  {type.detail}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {rightsType === "licensed" ? (
        <div>
          <label htmlFor="licenceRef" className="label text-forest/75">
            Which licence?
          </label>
          <input
            id="licenceRef"
            name="licenceRef"
            type="text"
            required
            className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 text-base"
          />
          <p className="text-forest/70 mt-1.5 text-xs">
            An invoice number or the agency&rsquo;s name is enough.
          </p>
        </div>
      ) : null}

      {rightsType === "operator_granted" ? (
        <div>
          <label htmlFor="thirdPartyRef" className="label text-forest/75">
            Who gave you permission?
          </label>
          <input
            id="thirdPartyRef"
            name="thirdPartyRef"
            type="text"
            required
            className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 text-base"
          />
        </div>
      ) : null}

      <fieldset>
        <legend className="label text-forest/75">
          Did everybody recognisable in it agree to being filmed?
        </legend>
        {/*
          Two radios and NO default. "`peopleConsentConfirmed` must be an
          explicit true or false, never defaulted and never omitted: consent of
          the people filmed is the one thing a moderator cannot check by
          watching."

          A checkbox would default to unticked, which is an answer nobody gave
          — and it is the answer that gets a clip rejected. So the form refuses
          to guess, and an unanswered submit is refused rather than sent as a
          quiet no.
        */}
        <div className="mt-2 space-y-2">
          <label className="rounded-edge border-cream-line bg-cream flex min-h-14 cursor-pointer items-center gap-3 border px-3">
            <input
              type="radio"
              name="peopleConsentConfirmed"
              value="yes"
              required
              className="size-5 shrink-0"
            />
            <span className="text-sm">Yes — they knew and agreed</span>
          </label>
          <label className="rounded-edge border-cream-line bg-cream flex min-h-14 cursor-pointer items-center gap-3 border px-3">
            <input
              type="radio"
              name="peopleConsentConfirmed"
              value="no"
              required
              className="size-5 shrink-0"
            />
            <span className="text-sm">
              No — or there is nobody recognisable in it
            </span>
          </label>
        </div>
        <p className="text-forest/70 mt-2 text-xs">
          There is no default here on purpose. A moderator can watch the clip;
          they cannot tell from watching whether the people in it agreed.
        </p>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="filmedOn" className="label text-forest/75">
            When was it filmed? (optional)
          </label>
          <input
            id="filmedOn"
            name="filmedOn"
            type="date"
            className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 text-base"
          />
        </div>
        <div>
          <label htmlFor="filmedAtLocation" className="label text-forest/75">
            Where? (optional)
          </label>
          <input
            id="filmedAtLocation"
            name="filmedAtLocation"
            type="text"
            className="rounded-edge border-cream-line bg-cream-deep mt-2 h-14 w-full border px-4 text-base"
          />
        </div>
      </div>

      {state.message ? (
        <p role="alert" className="text-terra-deep text-sm font-bold">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending || !hash}
        className="rounded-edge dock-target label bg-forest text-cream w-full px-5 font-bold disabled:cursor-not-allowed disabled:opacity-55"
      >
        {pending ? "Recording…" : "I confirm this, and submit for review"}
      </button>

      <p className="text-forest/70 text-xs">
        This does not publish anything. A person at Yuvoy checks it first, and
        the clip stays invisible to travellers until they do.
      </p>
    </form>
  );
}
