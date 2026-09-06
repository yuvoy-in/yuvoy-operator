"use client";

import { useActionState } from "react";
import { saveDetails, type DetailsState } from "./actions";
import {
  ENTITY_TYPES,
  entityLabel,
  isMissing,
  type BusinessDetails,
  type DetailsFormValues,
} from "@/lib/profile/details";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { inputClass } from "@/components/ui/input";
import { Panel } from "@/components/ui/panel";

/**
 * The legal details an invoice and a payout both need.
 *
 * "Collected during onboarding rather than chased at the first payout run,
 * which is the worst moment to discover an operator has no registered address
 * on file."
 *
 * ## Read-only once the account is live, and the reason is worth saying
 *
 * "The verified documents were checked against the legal name on file, so
 * changing it without anybody looking would make the verification
 * meaningless." That is copy that changes what somebody does — it tells them
 * to message us rather than hunt for an edit button — so it stays, where a
 * bare "you cannot edit this" would be the screen arguing with the reader.
 */
export function DetailsForm({
  details,
  values,
  editable,
}: {
  details: BusinessDetails | null;
  values: DetailsFormValues;
  editable: boolean;
}) {
  const [state, act, pending] = useActionState<DetailsState, FormData>(
    saveDetails,
    {},
  );

  if (!editable) {
    return (
      <Panel>
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-2xl">Business details</h2>
          <Chip>Locked</Chip>
        </div>
        <dl className="mt-4 space-y-3">
          <Row label="Registered name" value={details?.legalName} />
          <Row label="Entity type" value={entityLabel(details?.entityType)} />
          <Row label="GSTIN" value={details?.gstin} />
          <Row
            label="Registered address"
            value={[
              details?.address?.line1,
              details?.address?.line2,
              details?.address?.locality,
              details?.address?.region,
              details?.address?.postalCode,
            ]
              .filter(Boolean)
              .join(", ")}
          />
        </dl>
        <p className="text-forest/70 mt-4 text-sm">
          Your account is live, so these are fixed — the documents we verified
          were checked against them. Message us if anything here has changed.
        </p>
      </Panel>
    );
  }

  if (state.saved) {
    return (
      <Panel tone="done" role="status">
        <p className="text-base font-bold">Saved</p>
        <p className="text-forest/80 mt-2 text-sm">
          We have what an invoice and a payout need. Nothing goes live on this
          alone — the documents are the other half.
        </p>
      </Panel>
    );
  }

  return (
    <Panel>
      <h2 className="font-display text-2xl">Business details</h2>
      <p className="text-forest/70 mt-2 text-sm">
        The name the business is registered under, and where. An invoice and a
        payout both need these, and asking now beats chasing them on the day
        your first payout runs.
      </p>

      <form action={act} className="mt-5 space-y-5">
        <Field
          name="legalName"
          label="Registered name"
          defaultValue={values.legalName}
          missing={isMissing(details, "legalName")}
          invalid={state.field === "legalName"}
          hint="As it appears on your registration, not the name travellers see."
          required
        />

        <div>
          <label htmlFor="entityType" className="label text-forest/75">
            How it is registered
            {isMissing(details, "entityType") ? <Needed /> : null}
          </label>
          <select
            id="entityType"
            name="entityType"
            required
            defaultValue={values.entityType}
            className={inputClass("mt-2")}
            aria-invalid={state.field === "entityType" || undefined}
          >
            <option value="">Choose one</option>
            {ENTITY_TYPES.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </select>
        </div>

        <Field
          name="gstin"
          label="GSTIN"
          defaultValue={values.gstin}
          missing={false}
          invalid={state.field === "gstin"}
          /*
            The optionality is stated, not implied by an absent asterisk.
            "Plenty of island operators are under the registration threshold,
            and demanding a number they cannot legally obtain would block
            exactly the businesses this marketplace exists for."
          */
          hint="Only if you are registered. Leave it blank if you are not — plenty of operators are under the threshold."
        />

        <fieldset className="space-y-5">
          <legend className="label text-forest/75">Registered address</legend>
          <Field
            name="addressLine1"
            label="Street or building"
            defaultValue={values.addressLine1}
            missing={isMissing(details, "addressLine1")}
            invalid={state.field === "addressLine1"}
            required
          />
          <Field
            name="addressLine2"
            label="Area"
            defaultValue={values.addressLine2}
            missing={false}
            invalid={false}
          />
          <Field
            name="locality"
            label="Town or village"
            defaultValue={values.locality}
            missing={isMissing(details, "locality")}
            invalid={state.field === "locality"}
            required
          />
          <Field
            name="region"
            label="State or union territory"
            defaultValue={values.region}
            missing={isMissing(details, "region")}
            invalid={state.field === "region"}
            required
          />
          <Field
            name="postalCode"
            label="PIN code"
            defaultValue={values.postalCode}
            missing={isMissing(details, "postalCode")}
            invalid={state.field === "postalCode"}
            required
          />
          <input type="hidden" name="country" value={values.country || "IN"} />
        </fieldset>

        {state.message ? (
          <p role="alert" className="text-terra-deep text-sm font-bold">
            {state.message}
          </p>
        ) : null}

        <Button type="submit" disabled={pending} variant="primary">
          {pending ? "Saving…" : "Save these details"}
        </Button>
      </form>
    </Panel>
  );
}

/** The API named this field as outstanding. Marked on the row, not counted. */
function Needed() {
  return (
    <span className="text-terra-deep ml-2 text-[11px] font-bold">
      still needed
    </span>
  );
}

function Field({
  name,
  label,
  defaultValue,
  missing,
  invalid,
  hint,
  required,
}: {
  name: string;
  label: string;
  defaultValue: string;
  missing: boolean;
  invalid: boolean;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="label text-forest/75">
        {label}
        {missing ? <Needed /> : null}
      </label>
      <input
        id={name}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className={inputClass("mt-2")}
        aria-invalid={invalid || undefined}
        aria-describedby={hint ? `${name}-hint` : undefined}
      />
      {hint ? (
        <p id={`${name}-hint`} className="text-forest/70 mt-1.5 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <dt className="label text-forest/70">{label}</dt>
      <dd className="mt-0.5 text-sm">
        {value ? value : <span className="text-forest/70">Not on file</span>}
      </dd>
    </div>
  );
}
