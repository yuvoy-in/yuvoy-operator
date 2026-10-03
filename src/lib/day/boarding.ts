import { formatPaise } from "@/lib/format/money";
import type { BookingCash } from "@/lib/money/bookings";
import type { ScreeningSignal } from "./screening";

/**
 * Boarding mode's rules: who is still to come, who is aboard, the count
 * read at arm's length, and finding a party by what they say at the jetty
 * (operator experiment D, approved 3 Oct 2026 for the manifest).
 *
 * Pure, so the order a wet thumb meets and the words a row says are proved
 * without a browser.
 */

/** One party as boarding draws it. Only what a jetty row needs. */
export interface BoardingParty {
  bookingId: string;
  name: string;
  reference: string;
  guests: number;
  arrived: boolean;
  /** The booking's state: only a booking still on can be checked in. */
  state: string;
  cash: BookingCash | null;
  signal: ScreeningSignal;
  /** Unread messages from them; 0 when none or unknown. */
  unread: number;
}

/** A booking that can still be checked in. */
export function boardable(party: Pick<BoardingParty, "state">): boolean {
  const key = party.state.trim().toLowerCase();
  return key === "confirmed" || key === "paid_pending_ops";
}

/**
 * Still to come first, then aboard, each by name: the operator is matching
 * a person who just said their name, and the ones already aboard sink out of
 * the way (D: "a checked-in party sinks into Aboard").
 *
 * `held` are check-ins taken on this phone and not yet sent: they read as
 * aboard, so the row moves the moment the thumb leaves it.
 */
export function boardingOrder(
  parties: readonly BoardingParty[],
  held: ReadonlySet<string>,
): { toCome: BoardingParty[]; aboard: BoardingParty[] } {
  const byName = (a: BoardingParty, b: BoardingParty) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  const isAboard = (p: BoardingParty) => p.arrived || held.has(p.bookingId);
  return {
    toCome: parties.filter((p) => !isAboard(p)).sort(byName),
    aboard: parties.filter(isAboard).sort(byName),
  };
}

/** Guests aboard of guests booked: the number read at arm's length. */
export function headcount(
  parties: readonly BoardingParty[],
  held: ReadonlySet<string>,
): { aboard: number; booked: number } {
  let aboard = 0;
  let booked = 0;
  for (const p of parties) {
    booked += p.guests;
    if (p.arrived || held.has(p.bookingId)) aboard += p.guests;
  }
  return { aboard, booked };
}

/** The cash still to take from everybody on it, or null when a fare is unknown. */
export function cashToTake(parties: readonly BoardingParty[]): number | null {
  let total = 0;
  for (const p of parties) {
    if (!p.cash || p.cash.collected) continue;
    if (p.cash.collectPaise === null) return null;
    total += p.cash.collectPaise;
  }
  return total;
}

/**
 * Whether a party is the one somebody is looking for: a word of their name
 * from its start ("asha", "men"), or their reference as it is read out,
 * with or without "YV-" and the last four alone ("9p7q").
 */
export function matchesParty(
  party: Pick<BoardingParty, "name" | "reference">,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const words = party.name.toLowerCase().split(/\s+/);
  if (words.some((w) => w.startsWith(q))) return true;
  if (party.name.toLowerCase().startsWith(q)) return true;
  const bare = q.replace(/^yv-?/, "").replace(/[\s-]/g, "");
  const ref = party.reference
    .toLowerCase()
    .replace(/^yv-?/, "")
    .replace(/-/g, "");
  return bare.length >= 2 && ref.includes(bare);
}

/**
 * A row's flags, in words, never colour alone: what to take, what to ask,
 * who wrote. The medical flag is the manifest's instruction and nothing
 * about what anybody disclosed.
 */
export function boardingFlags(party: BoardingParty): string[] {
  const flags: string[] = [];
  if (party.cash && !party.cash.collected) {
    flags.push(
      party.cash.collectPaise === null
        ? "Cash to take"
        : `Cash ${formatPaise(party.cash.collectPaise)}`,
    );
  }
  if (party.signal === "flagged") flags.push("Medical: talk first");
  else if (party.signal === "outstanding") flags.push("No medical answer");
  if (party.unread > 0) {
    flags.push(party.unread === 1 ? "1 message" : `${party.unread} messages`);
  }
  return flags;
}
