import type { components } from "@/lib/api/schema.gen";

/**
 * What a change request is about, in the API's own words.
 *
 * `ChangeRequest.kind` is a bare `string` in the contract, with no enum, and
 * when Payout details was built (O4, 1 Sep 2026) this portal guessed the bank's
 * as `bank`. The API writes `bank_account`. So for three weeks Payout details
 * found no bank change at all: not the one in flight, whose Stop exists to catch
 * a stolen login moving a season's takings, not the account on file, and
 * Earnings never said a payout was held. The mock wrote `bank` too, which is how
 * every test stayed green over a screen that could never work.
 *
 * The six are the database's own list (`operator_change_requests_kind_check`,
 * yuvoy-api migration 0064). `contact`, `capacity` and `listing` are declared
 * there and written by nothing today.
 *
 * The kind is narrowed where the response enters (`getChangeRequests`), and
 * every comparison is against this type, so a hand-typed "bank" is a type error
 * ("This comparison appears to be unintentional") rather than a screen that
 * quietly shows nothing. A kind this list does not know arrives as `other`:
 * kept, so nothing is dropped, and never mistaken for one this portal acts on.
 */
export const CHANGE_KINDS = [
  "bank_account",
  "profile",
  "logo",
  "contact",
  "capacity",
  "listing",
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Where the money goes: OWNER to raise, OWNER or ADMIN to stop, two clocks. */
export const BANK_CHANGE = "bank_account" satisfies ChangeKind;

type ApiChangeRequest = components["schemas"]["ChangeRequest"];

/** A change request as this portal reads it: its `kind` narrowed on the way in. */
export type ChangeRequest = Omit<ApiChangeRequest, "kind"> & {
  kind: ChangeKind | "other";
};

export function toChangeKind(raw: unknown): ChangeKind | "other" {
  return typeof raw === "string" &&
    (CHANGE_KINDS as readonly string[]).includes(raw)
    ? (raw as ChangeKind)
    : "other";
}

export function toChangeRequest(raw: ApiChangeRequest): ChangeRequest {
  return { ...raw, kind: toChangeKind(raw.kind) };
}
