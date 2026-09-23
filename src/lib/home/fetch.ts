import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import { getManifest, listMedia } from "@/lib/day/manifest";
import type { Manifest, OperatorSlot } from "@/lib/day/types";
import { getCommissionOwed, getSettlementOverview } from "@/lib/money/fetch";
import { toHomeListing, type HomeListing } from "./listings";
import type { MoneyWeek } from "./money";

/**
 * Home's own reads (yuvoy-operator#96), each failing soft and on its own.
 *
 * "Every read on Home fails soft and independently: one failed read hides or
 * explains its own block and never blanks the screen." So nothing here
 * throws: each answers `null` (or an empty map) for "could not read", which
 * the block it feeds says in its own words, and the rest of Home stands.
 *
 * None of these is asked per listing. The listings are one read, the money is
 * two, and the only per-row read is one manifest for each of TODAY's
 * departures that has somebody on it, which is where the cash and the
 * arrivals are.
 */

/** Every listing, with what Home counts on each, or `null`. */
export async function readHomeListings(
  token: string,
): Promise<HomeListing[] | null> {
  try {
    const { data, error } = await operatorApi(token).GET("/experiences", {});
    if (error) return null;
    return (data.experiences ?? [])
      .map(toHomeListing)
      .filter((l): l is HomeListing => l !== null);
  } catch {
    return null;
  }
}

/**
 * The manifests of today's departures that have somebody on them.
 *
 * A departure with nobody sold has nobody to check in and no cash to take,
 * so it is not read; a called-off one has nobody on it at all. One that did
 * not load maps to `null`, and its row simply says less.
 */
export async function readManifests(
  token: string,
  slots: readonly OperatorSlot[],
): Promise<Map<string, Manifest | null>> {
  const wanted = slots.filter((s) => s.status !== "cancelled" && s.sold > 0);
  const read = await Promise.all(
    wanted.map((s) =>
      getManifest(token, s.id).then(
        (m) => [s.id, m] as const,
        () => [s.id, null] as const,
      ),
    ),
  );
  return new Map(read);
}

export interface MoneyToday {
  week: MoneyWeek | null;
  /** Owed to Yuvoy now on cash already taken. */
  owedPaise: number | null;
  /** Past cash trips nobody recorded (yuvoy-api#221). */
  unrecorded: number | null;
}

/**
 * The week, what is owed on cash, and the cash trips nobody recorded: two
 * reads, both OWNER, ADMIN or MANAGER. The caller asks only for a login that
 * can manage; a staff login would be refused both.
 *
 * `unrecorded` is `/commission-owed`'s count, and the overview's "same count"
 * stands in when only that one answered. Either figure read as optional: an
 * older API sends neither, and "0 unrecorded" from silence would be a claim.
 */
export async function readMoneyToday(token: string): Promise<MoneyToday> {
  const [overview, owed] = await Promise.all([
    getSettlementOverview(token).catch(() => null),
    getCommissionOwed(token).catch(() => null),
  ]);

  const next = overview?.nextSettlement;
  const week: MoneyWeek | null =
    next &&
    typeof next.periodStart === "string" &&
    typeof next.periodEnd === "string" &&
    typeof next.settlesFrom === "string" &&
    Number.isInteger(next.netPaise)
      ? {
          periodStart: next.periodStart,
          periodEnd: next.periodEnd,
          settlesFrom: next.settlesFrom,
          netPaise: next.netPaise,
        }
      : null;

  const fromOverview = overview?.paidAtCounter?.unrecordedBookings;
  const unrecorded = owed?.unrecorded
    ? owed.unrecorded.bookings
    : Number.isInteger(fromOverview)
      ? (fromOverview as number)
      : null;

  return {
    week,
    owedPaise: owed ? owed.commissionPaise : null,
    unrecorded,
  };
}

/**
 * How many reels the account holds, or `null`: the checklist's last step.
 *
 * Reels only, by `kind`, which is read and never inferred: a photograph is not
 * the footage that sells a listing, and an item this build cannot name is not
 * counted as one. Asked only while the checklist is on screen.
 */
export async function readReelCount(token: string): Promise<number | null> {
  try {
    const { items } = await listMedia(token);
    return items.filter((item) => item.kind === "video").length;
  } catch {
    return null;
  }
}
