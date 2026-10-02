import type { components } from "@/lib/api/schema.gen";

/**
 * What a change request is about, in the API's own words.
 *
 * `ChangeRequest.kind` was a bare `string` in the contract, with no enum, and
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
 * Since yuvoy-api#240 (#243, pinned 2 Oct 2026) the contract declares the same
 * six as an enum, so `ChangeKind` is the contract's own type rather than a copy,
 * and the list below is held to it both ways: `satisfies` refuses a kind the
 * contract does not have, and `change-kind.test.ts` refuses one it has that is
 * missing here.
 *
 * The kind is still narrowed where the response enters (`getChangeRequests`).
 * An enum says what the API WILL send, never what a deployed one does send
 * (yuvoy-api#126), so a kind this list does not know arrives as `other`: kept,
 * so nothing is dropped, and never mistaken for one this portal acts on. Every
 * comparison is against this type, so a hand-typed "bank" is a type error
 * ("This comparison appears to be unintentional") rather than a screen that
 * quietly shows nothing.
 */
type ApiChangeRequest = components["schemas"]["ChangeRequest"];

export type ChangeKind = NonNullable<ApiChangeRequest["kind"]>;

export const CHANGE_KINDS = [
  "bank_account",
  "profile",
  "logo",
  "contact",
  "capacity",
  "listing",
] as const satisfies readonly ChangeKind[];

/** Where the money goes: OWNER to raise, OWNER or ADMIN to stop, two clocks. */
export const BANK_CHANGE = "bank_account" satisfies ChangeKind;

/** A change request as this portal reads it: its `kind` narrowed on the way in. */
export type ChangeRequest = Omit<ApiChangeRequest, "kind"> & {
  kind: ChangeKind | "other";
};

/** A row as it may actually arrive: any string where the enum is declared. */
type WireChangeRequest = Omit<ApiChangeRequest, "kind"> & { kind?: string };

export function toChangeKind(raw: unknown): ChangeKind | "other" {
  return typeof raw === "string" &&
    (CHANGE_KINDS as readonly string[]).includes(raw)
    ? (raw as ChangeKind)
    : "other";
}

export function toChangeRequest(raw: WireChangeRequest): ChangeRequest {
  return { ...raw, kind: toChangeKind(raw.kind) };
}
