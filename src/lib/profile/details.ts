import type { components } from "@/lib/api/schema.gen";

export type BusinessDetails = components["schemas"]["BusinessDetails"];

/**
 * The business behind the account — O6's first half.
 *
 * ## What this screen is for, in the API's own words
 *
 * "`GET /me` names what is outstanding and who it is waiting on. This is how
 * an operator acts on the half that is waiting on them — **until it existed
 * the screen named a blocker and then asked them to ring us**."
 *
 * `/account` has shown the blockers and the credential expiry dates since O3.
 * What it could not do was let anybody act on one. That is the whole of this
 * screen: legal details, a document, and the mark travellers see.
 */

/**
 * The entity types the API accepts, in the operator's own words.
 *
 * A closed enum on `PUT /profile`, so the picker is built from it rather than
 * from a list typed twice. `stateLabel`-style prettifying is not enough here —
 * "llp" and "private_limited" are legal terms with conventional spellings, and
 * an operator choosing how their own business is registered should see the
 * words their accountant uses.
 */
export const ENTITY_TYPES = [
  { value: "sole_proprietor", label: "Sole proprietor" },
  { value: "partnership", label: "Partnership" },
  { value: "llp", label: "LLP" },
  { value: "private_limited", label: "Private limited" },
  { value: "society", label: "Society" },
  { value: "trust", label: "Trust" },
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number]["value"];

export function isEntityType(v: string): v is EntityType {
  return ENTITY_TYPES.some((e) => e.value === v);
}

export function entityLabel(value: string | undefined): string | null {
  return ENTITY_TYPES.find((e) => e.value === value)?.label ?? value ?? null;
}

/**
 * The field names the API says are still outstanding.
 *
 * "Named rather than a bare boolean so a form can mark the specific rows." So
 * the form marks the specific rows — a completeness bar that says "3 missing"
 * without saying which three is a puzzle, not a prompt.
 *
 * Compared case-insensitively and with the address prefix tolerated, because
 * the response names its own fields (`addressLine1`) while `GET` nests them
 * under `address`. Matching loosely here is right: the cost of marking a row
 * that was not named is nil, and the cost of missing one is an operator
 * hunting for the field nobody highlighted.
 */
export function isMissing(
  details: BusinessDetails | null,
  field: string,
): boolean {
  const missing = details?.missing ?? [];
  const wanted = field.toLowerCase();
  return missing.some((m) => {
    const name = m.toLowerCase().replace(/^address\./, "");
    return name === wanted;
  });
}

/** Every field the API is still waiting for, or an empty list. */
export function missingFields(details: BusinessDetails | null): string[] {
  return [...(details?.missing ?? [])];
}

/**
 * The form's initial values, flattened from the nested `address`.
 *
 * `GET /profile` nests the address; `PUT /profile` takes it flat
 * (`addressLine1`, `locality`, …). That asymmetry is the API's, and the one
 * place it is reconciled is here — a form that read one shape and posted the
 * other by hand would drift the first time a field moved.
 */
export interface DetailsFormValues {
  legalName: string;
  entityType: string;
  gstin: string;
  addressLine1: string;
  addressLine2: string;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
}

export function toFormValues(
  details: BusinessDetails | null,
): DetailsFormValues {
  const address = details?.address ?? {};
  return {
    legalName: details?.legalName ?? "",
    entityType: details?.entityType ?? "",
    gstin: details?.gstin ?? "",
    addressLine1: address.line1 ?? "",
    addressLine2: address.line2 ?? "",
    locality: address.locality ?? "",
    region: address.region ?? "",
    postalCode: address.postalCode ?? "",
    country: address.country ?? "",
  };
}

/**
 * GSTIN, checked only for shape and only when supplied.
 *
 * "Deliberately optional — plenty of island operators are under the
 * registration threshold, and demanding a number they cannot legally obtain
 * would block exactly the businesses this marketplace exists for."
 *
 * Fifteen characters is the whole rule this portal enforces. The checksum and
 * the state-code table are the server's business, and a client that reimplemented
 * them would refuse a valid number the day either changed.
 */
export function gstinIssue(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return v.length === 15
    ? null
    : "A GSTIN is 15 characters. Leave it blank if you are not registered.";
}
