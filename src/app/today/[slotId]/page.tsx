import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readSessionToken, requireOperator } from "@/lib/auth/session";
import { getManifest } from "@/lib/day/manifest";
import { orderParties, isHolding } from "@/lib/day/types";
import { screeningSignal, screeningSummary } from "@/lib/day/screening";
import { OperatorApiError } from "@/lib/api/errors";
import {
  hasDeparted,
  marketDay,
  marketTime,
  now,
} from "@/lib/format/market-time";
import { Empty, Problem } from "@/components/ui/states";
import { PartyRow } from "./party-row";
import { RelayPanel } from "./relay-panel";
import { CallOffPanel } from "./call-off-panel";
import { RefreshOnFocus } from "@/components/chrome/refresh-on-focus";
import { Screen } from "@/components/chrome/screen";
import { Panel } from "@/components/ui/panel";

/**
 * The departure, not the word "Manifest" — yuvoy-operator#21.
 *
 * "A browser tab shows roughly the first 20 characters and nothing else", and
 * somebody with three manifests open needs to tell them apart. `Manifest ·
 * Yuvoy for operators` three times does not, so the time and the trip lead:
 * `07:00 Try-dive at Nemo Reef · Yuvoy for operators`.
 *
 * It reads the manifest it is about to render, which is free — Next dedupes
 * the fetch between `generateMetadata` and the page in the same request, so
 * this costs no extra call to the API.
 *
 * Every failure falls back to the plain word rather than throwing: a title is
 * not worth a 500, and `notFound()` from here would pre-empt the page's own
 * handling of the same 404, which is deliberately shaped to be no oracle.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slotId: string }>;
}): Promise<Metadata> {
  try {
    const { slotId } = await params;
    const token = await readSessionToken();
    if (!token) return { title: "Manifest" };

    const manifest = await getManifest(token, slotId);
    const startsAt = manifest.startsAt ?? "";
    const time = startsAt
      ? marketTime(startsAt, manifest.timezone ?? "Asia/Kolkata")
      : "";
    const title = [time, manifest.experience].filter(Boolean).join(" ");
    return { title: title || "Manifest" };
  } catch {
    return { title: "Manifest" };
  }
}

/*
  Never prerendered, never cached, and re-read after every write. The manifest
  is the live answer to "who is standing in front of me"; the brief's whole
  framing of this screen is that a manifest kept from memory disagrees with
  the boat.
*/
export const dynamic = "force-dynamic";

/**
 * O10 — who is coming.
 *
 * "If you build one screen well, build the manifest."
 *
 * Rendered entirely on the server. The session token is in an httpOnly cookie
 * this page's JavaScript cannot read, `/operator/v1` refuses CORS by design,
 * and there is no proxy route to reach it through — so the parties are in the
 * HTML on first paint, which on one bar of signal is the difference between a
 * usable screen and a spinner.
 */
export default async function ManifestPage({
  params,
}: {
  params: Promise<{ slotId: string }>;
}) {
  const { slotId } = await params;
  const { token, me } = await requireOperator();

  let manifest;
  try {
    manifest = await getManifest(token, slotId);
  } catch (err) {
    /*
      404 means gone OR belonging to another operator, and the contract is
      explicit that clients must not tell them apart: "a 403 would confirm the
      row exists, which is precisely what somebody probing ids wants to learn."
      One notFound(), one page, no oracle.
    */
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  const timezone = manifest.timezone ?? "Asia/Kolkata";
  const startsAt = manifest.startsAt ?? "";
  const parties = orderParties(manifest.parties ?? []);
  const totals = manifest.totals ?? {};

  /*
    Computed over the whole manifest, not over `confirmed` — holds are rows on
    this screen and one may walk up, so the denominator matches what is
    actually listed below. See `screening.ts` for why that matters.

    Note what is NOT done here: the parties are not re-sorted to bring flagged
    rows to the top. `orderParties` puts confirmed first and then alphabetical
    because "the operator is matching a person who just said their name", and
    that is the primary use of this list a hundred times a morning. The summary
    carries the count; the row carries the flag; the order stays findable.
  */
  const screening = screeningSummary(parties);

  /*
    The screener is stripped off every party before it reaches a client
    component, and reduced to one word each.

    Not tidiness. `PartyRow` is a client component, so whatever it is handed is
    serialised into the RSC payload in this page's HTML — and the whole party
    put `clear` (what somebody answered about their own health) and
    `answeredVersion` into the page source of a manifest that "never carries
    what anybody disclosed". Nothing was rendering either one; both were
    shipping. An e2e assertion against the served HTML now fails if they come
    back.
  */
  const rows = parties.map((full) => {
    // The signal is read from the whole party; the party then loses the field.
    const signal = screeningSignal(full, screening.asks);
    const { screening: _withheld, ...party } = full;
    void _withheld;
    return { party, signal };
  });
  const confirmedRows = rows.filter((r) => !isHolding(r.party));
  const holdRows = rows.filter((r) => isHolding(r.party));

  // Read once, in the async work, and passed down. A clock read during render
  // is impure and the React compiler refuses it — and a "has it departed yet"
  // that flips between two renders is a set of buttons appearing and vanishing
  // under a wet thumb.
  const departed = startsAt ? hasDeparted(startsAt, await now()) : false;

  return (
    <Screen
      nav={{ back: { href: "/today", label: "the day" } }}
      stageLabel="Manifest"
    >
      <RefreshOnFocus />

      <p className="eyebrow text-terra-deep">
        {startsAt ? marketDay(startsAt, timezone) : "Departure"}
      </p>
      <h1 className="font-display tracking-display mt-3 text-4xl leading-[1.05]">
        {startsAt ? marketTime(startsAt, timezone) : "—"}{" "}
        <span className="text-3xl">{manifest.experience}</span>
      </h1>

      {manifest.meetingPoint ? (
        <p className="text-forest/80 mt-3 text-base">{manifest.meetingPoint}</p>
      ) : null}

      {/* The departure is off. Nothing else on the page matters as much. */}
      {manifest.calledOff ? (
        <div className="mt-6">
          <Problem
            title="This departure is called off"
            body="Everybody on it has been told and refunded in full. Nothing below needs marking."
          />
        </div>
      ) : null}

      {/*
        Totals come from the server. They are computed there precisely "so
        three clients cannot disagree about them on a dock", and seatsSold
        and seatsSoldOffline answer different questions — an operator adding
        them together to get a head count is the mistake this layout avoids
        by never putting them beside each other as one number.
      */}
      <dl className="mt-8 grid grid-cols-3 gap-3">
        <Total label="Parties" value={totals.parties} />
        <Total label="Guests" value={totals.guests} />
        <Total label="Here" value={totals.arrived} />
      </dl>
      {totals.seatsSoldOffline ? (
        <p className="text-forest/70 mt-3 text-sm">
          {totals.seatsSoldOffline} more seat
          {totals.seatsSoldOffline === 1 ? "" : "s"} sold at your own counter.
          They are not on this list.
        </p>
      ) : null}

      {/*
        Telling the whole departure something. Above the list rather than
        below it: at 6am the thing an operator most often needs is to move a
        time or a meeting point for everybody, not to tick one person off.
      */}
      {!manifest.calledOff ? (
        <section className="mt-8" aria-labelledby="relay-all">
          <h2 id="relay-all" className="label text-forest/75">
            Tell everybody
          </h2>
          <RelayPanel slotId={slotId} who="everybody on this departure" />
        </section>
      ) : null}

      {/*
        The screener, summarised, directly above the list it is about.

        Rendered only on a departure that asks one — a snorkel trip shows
        nothing here at all, because "a false alarm on this signal teaches an
        instructor to skip the column".

        The zero case is said OUT LOUD rather than left as an absence, and that
        is the entire reason this block exists. A list of unmarked rows looks
        identical whether every guest answered or the question was never asked,
        and only one of those is safe to board.

        No number here is a claim about anybody's health, and none can become
        one: `clear` is not read by this screen or any other in the portal.
      */}
      {screening.asks ? (
        <section className="mt-8" aria-labelledby="screening">
          <h2 id="screening" className="label text-forest/75">
            Medical question
          </h2>
          <div className="mt-3">
            {screening.outstanding > 0 ? (
              <Problem
                title={`${screening.outstanding} of ${screening.total} ${
                  screening.outstanding === 1 ? "has" : "have"
                } no answer recorded`}
                body="Ask them before they board. They are marked in the list below."
              />
            ) : (
              <Panel className="p-6">
                <p className="text-base font-bold">
                  Everybody on this list has answered
                </p>
                <p className="text-forest/70 mt-2 text-sm">
                  {screening.flagged > 0
                    ? "Some rows below still ask you to check with them before boarding."
                    : "Nothing outstanding for this departure."}
                </p>
              </Panel>
            )}
          </div>
        </section>
      ) : null}

      <section className="mt-10" aria-labelledby="confirmed">
        <h2 id="confirmed" className="label text-forest/75">
          Coming
        </h2>
        {confirmedRows.length === 0 ? (
          <div className="mt-3">
            <Empty
              title="Nobody booked yet"
              body="When somebody books this departure they appear here, with the reference they will read out to you."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {confirmedRows.map(({ party, signal }) => (
              <PartyRow
                key={party.bookingId}
                party={party}
                slotId={slotId}
                departed={departed}
                screening={signal}
              />
            ))}
          </ul>
        )}
      </section>

      {/*
        Holds are on the manifest deliberately: "a party mid-checkout at
        08:40 may walk up at 08:55, and a manifest that omits them sends the
        operator into an argument they cannot win."
      */}
      {holdRows.length > 0 ? (
        <section className="mt-10" aria-labelledby="holding">
          <h2 id="holding" className="label text-forest/75">
            Still paying
          </h2>
          <p className="text-forest/70 mt-2 text-sm">
            Not confirmed seats. They may finish paying and turn up, or the hold
            may lapse.
          </p>
          <ul className="mt-3 space-y-3">
            {holdRows.map(({ party, signal }, i) => (
              <PartyRow
                key={party.reference ?? i}
                party={party}
                slotId={slotId}
                departed={departed}
                screening={signal}
              />
            ))}
          </ul>
        </section>
      ) : null}

      <CallOffPanel
        slotId={slotId}
        alreadyCalledOff={Boolean(manifest.calledOff)}
        canManage={me.canManage}
      />
    </Screen>
  );
}

function Total({ label, value }: { label: string; value?: number }) {
  return (
    <Panel className="p-4">
      <dt className="label text-forest/70">{label}</dt>
      <dd className="font-display mt-1 text-3xl leading-none">{value ?? 0}</dd>
    </Panel>
  );
}
