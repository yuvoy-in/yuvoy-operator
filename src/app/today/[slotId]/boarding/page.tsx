import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { getManifest, listSlots } from "@/lib/day/manifest";
import { unreadByParty } from "@/lib/day/unread";
import { departuresOn, marketDayOf } from "@/lib/day/calendar";
import type { BoardingParty } from "@/lib/day/boarding";
import { screeningSignal, screeningSummary } from "@/lib/day/screening";
import { isHolding, orderParties, type Manifest } from "@/lib/day/types";
import { OperatorApiError } from "@/lib/api/errors";
import { hasDeparted, marketTime, now } from "@/lib/format/market-time";
import { toBookingCash } from "@/lib/money/bookings";
import { backFrom, hereWith, withFrom } from "@/lib/site/back-to";
import { Screen } from "@/components/chrome/screen";
import { BoardingScreen, type BoardingRow } from "./boarding-screen";

export const metadata: Metadata = { title: "Boarding" };

/*
  Never prerendered, never cached: who has arrived is the whole screen, and a
  manifest kept from memory disagrees with the boat.
*/
export const dynamic = "force-dynamic";

/**
 * Boarding mode (operator experiment D, approved 3 Oct 2026 for the
 * manifest): the departure as the jetty needs it at 06:00. A focused screen,
 * the bar hidden, Back and "Done boarding" both returning to the departure.
 *
 * One read: the manifest, which carries who is on the boat, the boat's seats
 * and who wrote, by booking, since yuvoy-api#260. On an API from before it,
 * the day's departures are read for the seats and the inbox is walked for
 * who wrote, as it was. A 404 on the manifest is "gone or not yours", one
 * answer, as on the departure.
 *
 * The screener never reaches the client: each party is reduced to one word
 * on the server (`screeningSignal`) and the field is taken off, as the
 * manifest's contract asks of every page.
 */
export default async function BoardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slotId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ slotId }, query] = await Promise.all([params, searchParams]);
  const { token, me } = await requireOperator();

  let manifest;
  try {
    manifest = await getManifest(token, slotId);
  } catch (err) {
    if (err instanceof OperatorApiError && err.isNotFound) notFound();
    throw err;
  }

  const timezone = manifest.timezone ?? "Asia/Kolkata";
  const startsAt = manifest.startsAt ?? "";
  const time = startsAt ? marketTime(startsAt, timezone) : "";
  const day = startsAt ? marketDayOf(startsAt, timezone) : null;
  const counted = seatsOn(manifest.totals);
  const [at, daySlots, unread] = await Promise.all([
    now(),
    // Only an older manifest, with no seats on it, sends for the day's list.
    !counted && day
      ? listSlots(token, day, day).catch(() => null)
      : Promise.resolve(null),
    unreadByParty(token, manifest),
  ]);
  const departed = startsAt ? hasDeparted(startsAt, at) : false;
  const calledOff = Boolean(manifest.calledOff);

  const slot = daySlots
    ? departuresOn(daySlots, day ?? "").find((s) => s.id === slotId)
    : undefined;
  const sold =
    counted ??
    (slot
      ? { sold: slot.sold, offline: slot.soldOffline ?? 0, seats: slot.seats }
      : null);
  /*
    Both `seats` already have the counter's sales taken off, so they go back
    on both sides: six seats with two sold at the counter is "2 of 6", not
    "0 of 4".
  */
  const seats = sold
    ? `${sold.sold + sold.offline} of ${sold.seats + sold.offline} seats sold`
    : null;

  // Boarding goes back to the departure, which keeps its own way back.
  const departure = backFrom(query.from, {
    href: `/today/${slotId}`,
    label: "the departure",
  });
  const here = hereWith(`/today/${slotId}/boarding`, query);

  const all = orderParties(manifest.parties ?? []);
  const screening = screeningSummary(all);
  const rows: BoardingRow[] = all
    .filter((p) => !isHolding(p) && p.bookingId)
    .map((full) => {
      const signal = screeningSignal(full, screening.asks);
      const { screening: _withheld, ...client } = full;
      void _withheld;
      const id = full.bookingId as string;
      const party: BoardingParty = {
        bookingId: id,
        name: full.name?.trim() || "A guest",
        reference: full.reference ?? "",
        guests: full.guests ?? 0,
        arrived: Boolean(full.arrived),
        state: full.state ?? "",
        cash: toBookingCash(full.cash) ?? null,
        signal,
        unread: unread?.[id] ?? 0,
      };
      return {
        party,
        client,
        bookingHref: withFrom(`/bookings/${id}`, here),
      };
    });

  const where = manifest.meetingPoint?.split(",")[0]?.trim();
  const mode = calledOff ? "Called off" : departed ? "Closing out" : "Boarding";

  return (
    <Screen nav={{ back: departure }}>
      <BoardingScreen
        slotId={slotId}
        mode={mode}
        time={time}
        where={where ?? ""}
        experience={manifest.experience ?? ""}
        departed={departed}
        calledOff={calledOff}
        seats={seats}
        rows={rows}
        timezone={timezone}
        canManage={me.canManage}
        doneHref={departure.href}
      />
    </Screen>
  );
}

/**
 * Seats sold against the boat's seats, off the manifest's own totals since
 * yuvoy-api#260 ("so '5 of 8 booked' needs no second read"), or `null` on
 * an older manifest, which has no `seats` and sends the page to the day's
 * departures for them. `seats` is the number `GET /slots` carries, read by
 * the same column, so the two lines cannot disagree.
 */
function seatsOn(
  totals: Manifest["totals"],
): { sold: number; offline: number; seats: number } | null {
  const seats = totals?.seats;
  const sold = totals?.seatsSold;
  if (!isCount(seats) || !isCount(sold)) return null;
  const offline = totals?.seatsSoldOffline;
  return { sold, offline: isCount(offline) ? offline : 0, seats };
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
