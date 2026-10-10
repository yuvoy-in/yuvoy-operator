import "server-only";
import { readUnreadByBooking } from "@/lib/site/inbox";
import type { Manifest } from "./types";

/**
 * Unread messages by booking for a departure's parties, so a row can say
 * "2 new messages" at the jetty (audit 5.2), or `null` when nobody could
 * count them, which draws no flag rather than a zero nobody measured.
 *
 * The manifest counts each party itself since yuvoy-api#260, "the same count
 * `GET /message-threads` gives the same booking", so the list and its flags
 * are one read. An older manifest does not, and absent means the old
 * behaviour: the inbox walked and joined on the booking, as it was. That
 * walk starts only once the manifest has said it is needed, never beside
 * it, because on the API that counts per party it is the very cost #260
 * took away.
 */
export async function unreadByParty(
  token: string,
  manifest: Manifest,
): Promise<Record<string, number> | null> {
  const booked = (manifest.parties ?? []).filter((party) => party.bookingId);
  // Nobody booked is nobody who can have written: nothing to ask.
  if (booked.length === 0) return {};
  if (!countsUnread(manifest, booked)) return readUnreadByBooking(token);
  const counts: Record<string, number> = {};
  for (const party of booked) {
    const count = party.unreadCount;
    // A negative or fractional count is not a count; the row draws none.
    if (Number.isInteger(count) && (count as number) >= 0) {
      counts[party.bookingId as string] = count as number;
    }
  }
  return counts;
}

/**
 * Whether the manifest is from an API that counts unread per party. There
 * every booked party carries `unreadCount`, `0` included, and `totals.seats`
 * arrived in the same release (yuvoy-api#295), so either one says so.
 */
function countsUnread(
  manifest: Manifest,
  booked: NonNullable<Manifest["parties"]>,
): boolean {
  return (
    typeof manifest.totals?.seats === "number" ||
    booked.some((party) => typeof party.unreadCount === "number")
  );
}
