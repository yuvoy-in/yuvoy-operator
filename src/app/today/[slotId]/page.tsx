import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readSessionToken, requireOperator } from "@/lib/auth/session";
import { getManifest } from "@/lib/day/manifest";
import { orderParties, isHolding } from "@/lib/day/types";
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
  const confirmed = parties.filter((p) => !isHolding(p));
  const holds = parties.filter(isHolding);
  const totals = manifest.totals ?? {};

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

      <section className="mt-10" aria-labelledby="confirmed">
        <h2 id="confirmed" className="label text-forest/75">
          Coming
        </h2>
        {confirmed.length === 0 ? (
          <div className="mt-3">
            <Empty
              title="Nobody booked yet"
              body="When somebody books this departure they appear here, with the reference they will read out to you."
            />
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {confirmed.map((party) => (
              <PartyRow
                key={party.bookingId}
                party={party}
                slotId={slotId}
                departed={departed}
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
      {holds.length > 0 ? (
        <section className="mt-10" aria-labelledby="holding">
          <h2 id="holding" className="label text-forest/75">
            Still paying
          </h2>
          <p className="text-forest/70 mt-2 text-sm">
            Not confirmed seats. They may finish paying and turn up, or the hold
            may lapse.
          </p>
          <ul className="mt-3 space-y-3">
            {holds.map((party, i) => (
              <PartyRow
                key={party.reference ?? i}
                party={party}
                slotId={slotId}
                departed={departed}
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
