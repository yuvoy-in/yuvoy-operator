import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { getManifest, listSlots } from "@/lib/day/manifest";
import { departuresOn, marketDayOf } from "@/lib/day/calendar";
import type { BoardingParty } from "@/lib/day/boarding";
import { screeningSignal, screeningSummary } from "@/lib/day/screening";
import { isHolding, orderParties } from "@/lib/day/types";
import { OperatorApiError } from "@/lib/api/errors";
import { hasDeparted, marketTime, now } from "@/lib/format/market-time";
import { toBookingCash } from "@/lib/money/bookings";
import { backFrom, hereWith, withFrom } from "@/lib/site/back-to";
import { readInbox } from "@/lib/site/inbox";
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
 * Three reads, at once: the manifest (who), the day's departures (how many
 * seats the boat has, which the manifest does not carry: yuvoy-api#260), and
 * the inbox walk the layout already made (who wrote, by booking). A 404 on
 * the manifest is "gone or not yours", one answer, as on the departure.
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
  const inbox = readInbox(token);

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
  const [at, daySlots, read] = await Promise.all([
    now(),
    day ? listSlots(token, day, day).catch(() => null) : Promise.resolve(null),
    inbox,
  ]);
  const departed = startsAt ? hasDeparted(startsAt, at) : false;
  const calledOff = Boolean(manifest.calledOff);

  const slot = daySlots
    ? departuresOn(daySlots, day ?? "").find((s) => s.id === slotId)
    : undefined;
  const seats = slot
    ? `${slot.sold + (slot.soldOffline ?? 0)} of ${slot.seats + (slot.soldOffline ?? 0)} seats sold`
    : null;

  // Boarding goes back to the departure, which keeps its own way back.
  const departure = backFrom(query.from, {
    href: `/today/${slotId}`,
    label: "the departure",
  });
  const here = hereWith(`/today/${slotId}/boarding`, query);
  const unread = read?.unreadByBooking ?? {};

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
        unread: unread[id] ?? 0,
      };
      return {
        party,
        client,
        bookingHref: withFrom(`/bookings/${id}`, here),
      };
    });

  const where = manifest.meetingPoint?.split(",")[0]?.trim();
  const mode = calledOff ? "Called off" : departed ? "Closing out" : "Boarding";
  const kicker = [mode, time, where].filter(Boolean).join(" · ");

  return (
    <Screen nav={{ back: departure }}>
      <BoardingScreen
        slotId={slotId}
        kicker={kicker}
        title={[time, manifest.experience].filter(Boolean).join(" ")}
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
