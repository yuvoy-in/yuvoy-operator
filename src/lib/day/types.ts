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
 * A party as a CLIENT component may receive one — the screener stripped off.
 *
 * Every prop a client component takes is serialised into the RSC payload in
 * the HTML, so "the row does not render `clear`" is not the same promise as
 * "`clear` is not in the page". The manifest's contract asks for the second:
 * it "never carries what anybody disclosed", on a screen "read on a jetty, out
 * loud, in front of other customers".
 *
 * So the screener is reduced to one word on the server (`screeningSignal`) and
 * the field itself never crosses the boundary. `Omit` rather than a hand-listed
 * shape on purpose: a field added to `Party` by a future contract bump arrives
 * here automatically, and only `screening` is deliberately held back.
 *
 * ## `screening?: never` is doing real work — `Omit` alone is not enough
 *
 * TypeScript only checks for excess properties on object LITERALS. A whole
 * `Party` held in a variable is structurally assignable to `Omit<Party,
 * "screening">` and passes silently, which is exactly how a party would reach
 * a client component: through a variable, not a literal. `screening?: never`
 * closes that, because a real screener is not assignable to `never` however it
 * arrives. A test pins it with `@ts-expect-error`, so this line cannot be
 * "simplified" back to a bare `Omit` without the build saying so.
 */
export type PartyForClient = Omit<Party, "screening"> & { screening?: never };

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

/**
 * A departure, as the capacity screen renders it.
 *
 * Lives here rather than beside its fetcher for the same reason `Party` does:
 * `manifest.ts` is `server-only` because it holds a session token, and a
 * client component needing this shape must not import that module. `pnpm qa`
 * caught exactly this when the capacity row was first written — a type-only
 * import would have compiled and left the edge to break later.
 */
export interface OperatorSlot {
  id: string;
  title: string;
  startsAt: string;
  timezone: string;
  seats: number;
  sold: number;
  remaining: number;
  /**
   * Whether this departure holds seats or waits on the operator to answer.
   *
   * On the departure rather than the listing, because "a listing can carry
   * both, and this screen is looking at departures". It changes what
   * `remaining` means: on an `allotment` departure it is seats Yuvoy is
   * holding, and on a `request` one nothing is held until the operator says
   * yes.
   *
   * Optional because the field is new (yuvoy-api@e16217a8) and a row without
   * it must render as a row that says nothing, not as `allotment`. Guessing
   * would put "3 seats left" against a departure holding none.
   */
  bookingMode?: "allotment" | "request";
  status: string;
}

/**
 * One of the operator's listings, as far as this portal can know them.
 *
 * **Derived from departures, because there is no way to enumerate listings.**
 * The operator contract has no `GET /experiences` — `POST /experiences/{id}/revisions`
 * takes an id nothing hands out — so the only place a listing's id and title
 * appear is on the departures it already has.
 *
 * That is a real limitation with a real edge: an operator whose listing has no
 * departure anywhere in the window cannot add one to it, and an operator with
 * no departures at all cannot add their first. The capacity screen says so
 * rather than rendering an empty picker, and it is raised on yuvoy-api rather
 * than papered over — a text field for a listing id would be worse, because
 * the id is not something anybody has.
 */
export interface OperatorListing {
  id: string;
  title: string;
}
