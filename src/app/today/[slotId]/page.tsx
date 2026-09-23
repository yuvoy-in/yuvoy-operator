import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { readSessionToken, requireOperator } from "@/lib/auth/session";
import { getManifest } from "@/lib/day/manifest";
import { orderParties, isHolding, type PartyForClient } from "@/lib/day/types";
import { toBookingCash, type BookingCash } from "@/lib/money/bookings";
import { toGiveBack } from "@/lib/money/give-back";
import { formatPaise } from "@/lib/format/money";
import { CashBack } from "@/app/bookings/cash-back";
import { screeningSignal, screeningSummary } from "@/lib/day/screening";
import { OperatorApiError } from "@/lib/api/errors";
import {
  hasDeparted,
  marketDay,
  marketTime,
  now,
} from "@/lib/format/market-time";
import { Problem } from "@/components/ui/states";
import { PartyRow } from "./party-row";
import { RelayPanel } from "./relay-panel";
import { CallOffPanel } from "./call-off-panel";
import { RefreshOnFocus } from "@/components/chrome/refresh-on-focus";
import { Screen } from "@/components/chrome/screen";
import { Panel, panelClass } from "@/components/ui/panel";

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
 * handling of the same 404, which is deliberately shaped to be no oracle. The
 * plain word is "Departure": "Manifest" is a shipping word, not one an
 * operator uses (yuvoy-operator#96).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slotId: string }>;
}): Promise<Metadata> {
  try {
    const { slotId } = await params;
    const token = await readSessionToken();
    if (!token) return { title: "Departure" };

    const manifest = await getManifest(token, slotId);
    const startsAt = manifest.startsAt ?? "";
    const time = startsAt
      ? marketTime(startsAt, manifest.timezone ?? "Asia/Kolkata")
      : "";
    const title = [time, manifest.experience].filter(Boolean).join(" ");
    return { title: title || "Departure" };
  } catch {
    return { title: "Departure" };
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
 *
 * One title (yuvoy-operator#80 t2): the time and the trip. The day moved out
 * of the eyebrow above it into the line under it, beside where to meet, and
 * the "Manifest" stage caption went. Nothing explains the screen (#80 t4).
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

  /*
    CASH AT THE COUNTER (yuvoy-operator#40 §1), read off the manifest itself
    since yuvoy-api#204 (op#95 item 2).

    Each party carries `cash` exactly when it pays at the counter, the same
    object `GET /bookings` sends: "a party with a `bookingId` and no `cash` has
    paid and owes you nothing; it is not a party the check could not read."

    This used to be a second read, `GET /bookings` for the departure's day,
    joined by booking id. One page of it: past 100 bookings some parties came
    back unread and the screen said "We could not check whether 3 bookings here
    owe cash". Now the list and the cash come in one response and cannot
    disagree, and could-not-tell is left to the one case it is true, the
    manifest not loading at all, which is the error page. Checked live before
    switching: the deployed API is the release that carries it (e7291e3).
  */
  const cashOf = (party: PartyForClient): BookingCash | null =>
    party.bookingId ? (toBookingCash(party.cash) ?? null) : null;

  /*
    Cancelled parties whose cash is still in the till. They are NOT in
    `parties` ("`parties` is who is on the boat, and somebody cancelled is
    not"), and a called-off departure empties `parties` entirely, so without
    this the manifest named nobody the money belonged to (op#95).
  */
  const giveBack = toGiveBack(manifest.cashToGiveBack);

  // Read once, in the async work, and passed down. A clock read during render
  // is impure and the React compiler refuses it — and a "has it departed yet"
  // that flips between two renders is a set of buttons appearing and vanishing
  // under a wet thumb.
  const departed = startsAt ? hasDeparted(startsAt, await now()) : false;

  return (
    <Screen nav={{ back: { href: "/today", label: "the day" } }}>
      <RefreshOnFocus />

      <h1 className="font-display tracking-display text-4xl leading-[1.05]">
        {startsAt ? (
          <>
            <span className="tabular-nums">
              {marketTime(startsAt, timezone)}
            </span>{" "}
          </>
        ) : null}
        <span className="text-3xl">{manifest.experience || "Departure"}</span>
      </h1>

      {startsAt || manifest.meetingPoint ? (
        <p className="text-forest/80 mt-2 text-base">
          {[
            startsAt ? marketDay(startsAt, timezone) : "",
            manifest.meetingPoint,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      ) : null}

      {/*
        The departure is off. Nothing else on the page matters as much.

        It said "Everybody on it has been told and refunded in full", which was
        false twice: the call-off refunds what was paid ONLINE, so a traveller
        who paid at the counter got nothing back from us, and a message counts
        only the people we could reach. What is true is what the call-off did.
      */}
      {manifest.calledOff ? (
        <div className="mt-6">
          <Problem
            title="This departure is called off"
            body="Every booking on it is cancelled, and everything paid online goes back in full."
          />
        </div>
      ) : null}

      {/*
        Money the business is holding that is not theirs, above everything
        else below it: each party stays here until the return is recorded.
      */}
      {giveBack ? (
        <section className="mt-6" aria-labelledby="give-back">
          <div className={panelClass("alert")}>
            <h2 id="give-back" className="text-base font-bold">
              You are holding {formatPaise(giveBack.totalPaise)} that is not
              yours
            </h2>
            <p className="text-forest/80 mt-2 text-sm">
              {giveBack.parties.length === 1
                ? "This traveller paid you in cash, so nothing of theirs reached us to refund. Hand it back, then record it here."
                : "These travellers paid you in cash, so nothing of theirs reached us to refund. Hand it back, then record each one here."}
            </p>
            <ul className="mt-4 space-y-3">
              {giveBack.parties.map((party) => (
                <li
                  key={party.bookingId}
                  className="border-paper-line border-t pt-3"
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-mono text-base font-bold">
                      {party.reference || "-"}
                    </p>
                    <p className="shrink-0 text-base font-bold tabular-nums">
                      {formatPaise(party.amountPaise)}
                    </p>
                  </div>
                  <p className="text-forest/70 mt-1 text-sm">
                    {[
                      party.name,
                      party.guests === 1
                        ? "1 guest"
                        : party.guests > 1
                          ? `${party.guests} guests`
                          : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {/*
                    OWNER, ADMIN or MANAGER: "STAFF cannot record giving the
                    cash back". A staff login is told who can, rather than
                    shown a control the API will refuse.
                  */}
                  {me.canManage ? (
                    <CashBack
                      bookingId={party.bookingId}
                      amountPaise={party.amountPaise}
                      refreshLabel="Update the list"
                    />
                  ) : (
                    <p className="text-forest/70 mt-2 text-sm">
                      An owner, an admin or a manager records it once it is
                      handed back.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {/*
        Totals come from the server. They are computed there precisely "so
        three clients cannot disagree about them on a dock", and seatsSold
        and seatsSoldOffline answer different questions — an operator adding
        them together to get a head count is the mistake this layout avoids
        by never putting them beside each other as one number.
      */}
      {manifest.calledOff ? null : (
        <dl className="mt-8 grid grid-cols-3 gap-3">
          <Total label="Parties" value={totals.parties} />
          <Total label="Guests" value={totals.guests} />
          {/*
            "Checked in", not "Here" (yuvoy-operator#88 s3): "Here" is our
            word, and on a jetty it reads as a question.
          */}
          <Total label="Checked in" value={totals.arrived} />
        </dl>
      )}
      {!manifest.calledOff && totals.seatsSoldOffline ? (
        <p className="text-forest/70 mt-3 text-sm">
          {totals.seatsSoldOffline === 1
            ? "1 more seat sold at your counter is not on this list."
            : `${totals.seatsSoldOffline} more seats sold at your counter are not on this list.`}
        </p>
      ) : null}

      {/*
        Telling the whole departure something. Above the list rather than
        below it: at 6am the thing an operator most often needs is to move a
        time or a meeting point for everybody, not to tick one person off.

        No heading: "Tell everybody" over a button saying "Tell everybody on
        this departure" was the same words twice where the guest list should
        be (yuvoy-operator#88 s3). The button carries it.
      */}
      {!manifest.calledOff ? (
        <RelayPanel slotId={slotId} who="everyone booked" />
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

      {/*
        A called-off departure has nobody on it: the API empties `parties`,
        and "Nobody booked yet" under it would read as a departure nobody
        wanted rather than one that was called off.
      */}
      {manifest.calledOff ? null : (
        <section className="mt-10" aria-labelledby="confirmed">
          <h2 id="confirmed" className="label text-forest/75">
            Coming
          </h2>
          {confirmedRows.length === 0 ? (
            <p className="text-forest/70 mt-3 text-base">Nobody booked yet</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {confirmedRows.map(({ party, signal }) => (
                <PartyRow
                  key={party.bookingId}
                  party={party}
                  slotId={slotId}
                  departed={departed}
                  screening={signal}
                  cash={cashOf(party)}
                  timezone={timezone}
                  canManage={me.canManage}
                />
              ))}
            </ul>
          )}
        </section>
      )}

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
          {/* Each row says what a hold means, so the section need not. */}
          <ul className="mt-3 space-y-3">
            {holdRows.map(({ party, signal }, i) => (
              <PartyRow
                key={party.reference ?? i}
                party={party}
                slotId={slotId}
                departed={departed}
                screening={signal}
                cash={cashOf(party)}
                timezone={timezone}
                canManage={me.canManage}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {/*
        Last, and quiet (yuvoy-operator#81 t5): text in the warning colour,
        behind a confirm that names the time and what happens to everyone on
        it.
      */}
      <CallOffPanel
        slotId={slotId}
        alreadyCalledOff={Boolean(manifest.calledOff)}
        canManage={me.canManage}
        time={startsAt ? marketTime(startsAt, timezone) : undefined}
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
