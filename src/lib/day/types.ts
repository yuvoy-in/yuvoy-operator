import type { components } from "@/lib/api/schema.gen";

/**
 * The manifest's shape and the pure things you can say about it.
 *
 * Split out of `manifest.ts` deliberately. That module is `server-only` —
 * it holds a session token and calls `/operator/v1` — and a client component
 * needing the `Party` type would otherwise import a module the browser must
 * never reach. A type-only import is erased and would have worked, which is
 * worse: it works until somebody adds a value import beside it and the build
 * fails somewhere unrelated.
 *
 * So the rule is structural rather than careful: nothing that touches a
 * session lives in a file a client may import, and `pnpm qa` fails the client
 * graph reaching the other one at all.
 */

export type Manifest = components["schemas"]["Manifest"];
export type Party = NonNullable<Manifest["parties"]>[number];

/**
 * A party still mid-checkout.
 *
 * The contract keeps live holds ON the manifest deliberately: "a party
 * mid-checkout at 08:40 may walk up at 08:55, and a manifest that omits them
 * sends the operator into an argument they cannot win". They carry an empty
 * `bookingId`, so there is nothing to tick them off against — which is exactly
 * why they must LOOK different rather than merely be sorted lower.
 */
export function isHolding(party: Party): boolean {
  return party.state === "holding" || !party.bookingId;
}

/**
 * The order the manifest reads in on a dock.
 *
 * Confirmed parties first, alphabetically by name — the operator is matching a
 * person who just said their name, not scanning by booking time. Holds sit at
 * the end, under their own heading.
 */
export function orderParties(parties: Party[]): Party[] {
  return [...parties].sort((a, b) => {
    const holdDiff = Number(isHolding(a)) - Number(isHolding(b));
    if (holdDiff !== 0) return holdDiff;
    return (a.name ?? "").localeCompare(b.name ?? "", "en");
  });
}
