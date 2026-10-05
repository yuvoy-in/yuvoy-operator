import { formatPaise } from "@/lib/format/money";
import { cashInHand, type Commission } from "./commission";
import { totalOwed, type CommissionStatement } from "./commission-statements";
import {
  hasStatement,
  seasonStartLabel,
  type PaidAtCounter,
  type SeasonToDate,
  type Settlement,
  type SettlementPipeline,
  type SettlementWeek,
} from "./settlements";

/**
 * What the Money tab leads with: yuvoy-operator#96, #87 s15.
 *
 * "The screen leads with ₹0, and the only real number, ₹55,250 of cash still
 * to collect, is third and smallest." An operator opens Money to answer one
 * question, what am I owed and what do I owe, and three panels that each
 * opened on a big ₹0 answered it with three zeroes first.
 *
 * So each block says whether it has anything in it, the screen draws the ones
 * that do first, and a week where nothing has money in it at all is said once,
 * in words. Nothing here adds one block's figure to another's: the pipeline is
 * never earned and cash never passes through a payout, and a total built
 * across them would say both.
 *
 * What the business owes is the weekly commission statements' (op#121,
 * D-043), never `GET /commission-owed`'s, which counts every completed cash
 * trip "billed or not, paid or not". So the cash block says what Yuvoy's
 * share is, and only the commission block says what is owed.
 */

/**
 * Whether the next payout has anything in it.
 *
 * Bookings OR a figure: a week with no bookings can still carry a correction
 * the lock will take with it, and that is news even when nothing is paid.
 */
export function payoutHasMoney(
  week: Pick<SettlementWeek, "bookings" | "netPaise">,
): boolean {
  return week.bookings > 0 || week.netPaise !== 0;
}

/** Whether any card booking is still to run. */
export function pipelineHasMoney(
  pipeline: Pick<SettlementPipeline, "bookings" | "netPaise">,
): boolean {
  return pipeline.bookings > 0 || pipeline.netPaise !== 0;
}

/**
 * The cash figures the Money tab summarises, from the two reads that carry
 * them: the overview's `paidAtCounter` (always there, or the screen is not)
 * and `GET /commission-owed` (read softly; `null` when it failed).
 *
 * Every field that depends on a read that did not answer is `null`, never
 * zero: a ₹0 drawn from a failed read is a figure nobody can tell from a real
 * one.
 */
export interface CashOnTheTab {
  /**
   * Whether `GET /commission-owed` answered. When it did not, the cash
   * figures are UNKNOWN and the screen says so: a failed read used to fall
   * through to "Nothing owed either way yet" (the audit, M3).
   */
  cashKnown: boolean;
  /** All the cash recorded taken, on completed trips and held, as Cash leads with it. */
  inHand: number | null;
  /**
   * Yuvoy's share on completed cash trips, every one of them, billed or not
   * and paid or not. Never "owed": what is still to pay is the statements'.
   */
  completedShare: number | null;
  /** Yuvoy's share on cash taken for trips still to run: owed once they run. */
  heldShare: number | null;
  /**
   * Cash bookings still to run, paid or not, and the cash already taken for
   * them. From the overview, so it survives `/commission-owed` failing.
   *
   * `null` against an API older than yuvoy-api#221, whose `bookings` still
   * carried past trips with nothing recorded as though they were to come (7
   * trips, ₹60,000, on a morning with nothing upcoming). The sign it is newer
   * is `unrecordedBookings`, which #221 added in the same change.
   */
  toRun: {
    bookings: number;
    farePaise: number;
    /** Cash already recorded taken for them, or `null` when not said. */
    takenPaise: number | null;
  } | null;
  /** Trips that ran with no cash recorded, or `null` when there are none. */
  unrecorded: { bookings: number; farePaise: number | null } | null;
}

export function cashOnTheTab(
  counter: PaidAtCounter,
  commission: Commission | null,
): CashOnTheTab {
  /*
    Unrecorded trips from the overview first: it is the read this screen
    cannot load without, and the contract promises the two agree. Read as
    optional all the same (an older API sends neither), and a count that is
    not a whole number is "not said", never zero.
  */
  const fromOverview = Number.isInteger(counter.unrecordedBookings)
    ? {
        bookings: counter.unrecordedBookings,
        farePaise: Number.isInteger(counter.unrecordedFarePaise)
          ? counter.unrecordedFarePaise
          : null,
      }
    : null;
  const unrecorded =
    fromOverview ??
    (commission?.unrecorded
      ? {
          bookings: commission.unrecorded.bookings,
          farePaise: commission.unrecorded.farePaise,
        }
      : null);

  const apiCountsToRunApart = Number.isInteger(counter.unrecordedBookings);
  return {
    cashKnown: commission !== null,
    inHand: commission ? cashInHand(commission) : null,
    completedShare: commission ? commission.commissionPaise : null,
    heldShare: commission?.held ? commission.held.commissionPaise : null,
    toRun: apiCountsToRunApart
      ? {
          bookings: whole(counter.bookings),
          farePaise: whole(counter.farePaise),
          takenPaise: Number.isInteger(counter.heldCollectedPaise)
            ? counter.heldCollectedPaise
            : null,
        }
      : null,
    unrecorded: unrecorded && unrecorded.bookings > 0 ? unrecorded : null,
  };
}

/**
 * The one figure the cash block leads with: the largest REAL one (#87 s15,
 * "lead with the number that is real this week").
 *
 * It led with "₹0 recorded as taken from travellers" when the only real
 * figure was ₹55,250 still to take on trips to run, which was the smallest row
 * (the audit, M4). Nothing leads when every figure is zero or unknown.
 */
export type CashLead =
  | { kind: "in-hand"; paise: number }
  | { kind: "to-take"; paise: number }
  | { kind: "share"; paise: number };

export function cashLead(cash: CashOnTheTab): CashLead | null {
  if ((cash.inHand ?? 0) > 0) return { kind: "in-hand", paise: cash.inHand! };
  const toTake = cash.toRun
    ? cash.toRun.farePaise - (cash.toRun.takenPaise ?? 0)
    : 0;
  if (toTake > 0) return { kind: "to-take", paise: toTake };
  if ((cash.completedShare ?? 0) > 0) {
    return { kind: "share", paise: cash.completedShare! };
  }
  return null;
}

/**
 * Whether the cash block has anything to say: a figure above zero, trips to
 * run or unrecorded, OR a cash read that failed, which it must say rather
 * than let the screen conclude there is nothing.
 */
export function cashHasMoney(cash: CashOnTheTab): boolean {
  return (
    !cash.cashKnown ||
    (cash.inHand ?? 0) > 0 ||
    (cash.completedShare ?? 0) > 0 ||
    (cash.heldShare ?? 0) > 0 ||
    (cash.toRun?.bookings ?? 0) > 0 ||
    cash.unrecorded !== null
  );
}

/**
 * What the Money tab knows about the weekly commission bill (op#121).
 *
 *   - `read`        whether `GET /commission-statements` answered at all
 *   - `owedPaise`   what is owed now across every statement, or `null` when
 *                   it cannot be said: the read failed, the list was cut
 *                   short, or a statement would not say what it owes
 *   - `statements`  every statement read, newest first; empty when it failed
 */
export interface CommissionOnTheTab {
  read: boolean;
  owedPaise: number | null;
  statements: readonly CommissionStatement[];
}

export function commissionOnTheTab(
  read: {
    items: readonly CommissionStatement[];
    complete: boolean;
  } | null,
): CommissionOnTheTab {
  if (read === null) return { read: false, owedPaise: null, statements: [] };
  return {
    read: true,
    owedPaise: totalOwed(read.items, read.complete),
    statements: read.items,
  };
}

/**
 * The top of the Money tab, in the order it is drawn.
 *
 *   - `commission`         what is owed on the commission statements, with
 *                          the ones still to pay; first, because it is the
 *                          one thing on the tab to do, and the weekly email
 *                          sends people here for it
 *   - `payout`             the next payout's card, with its arithmetic
 *   - `booked`             card bookings still to run, never earned
 *   - `commission-unknown` the statements did not load: said, in the place a
 *                          failure costs nothing above it
 *   - `cash`               cash taken and Yuvoy's share, with the door to Cash
 *   - `payout-quiet`       the next payout said in words, below the real
 *                          blocks, when it has nothing in it ("keep the
 *                          settlement card, but below")
 *   - `nothing-yet`        one sentence, when not one block has money in it
 *   - `commission-quiet`   statements, every one of them settled: listed
 *                          below, with nothing to pay
 *
 * The real blocks keep their order among themselves: what is owed to Yuvoy,
 * what Yuvoy will pay, what is booked, then cash. An empty block is never
 * drawn as a ₹0, and a total that could not be added up is a `commission`
 * block that says so, never a quiet one.
 */
export type MoneyBlock =
  | "commission"
  | "payout"
  | "booked"
  | "commission-unknown"
  | "cash"
  | "payout-quiet"
  | "nothing-yet"
  | "commission-quiet";

export function moneyBlocks(
  week: Pick<SettlementWeek, "bookings" | "netPaise">,
  pipeline: Pick<SettlementPipeline, "bookings" | "netPaise">,
  cash: CashOnTheTab,
  commission: CommissionOnTheTab,
): MoneyBlock[] {
  const { owedPaise, statements } = commission;
  const blocks: MoneyBlock[] = [];
  if (
    commission.read &&
    (owedPaise === null ? statements.length > 0 : owedPaise > 0)
  ) {
    blocks.push("commission");
  }
  if (payoutHasMoney(week)) blocks.push("payout");
  if (pipelineHasMoney(pipeline)) blocks.push("booked");
  if (!commission.read) blocks.push("commission-unknown");
  if (cashHasMoney(cash)) blocks.push("cash");

  if (blocks.length === 0) blocks.push("nothing-yet");
  else if (!blocks.includes("payout")) blocks.push("payout-quiet");

  if (owedPaise === 0 && statements.length > 0) {
    blocks.push("commission-quiet");
  }
  return blocks;
}

/**
 * "Since 1 April 2026: ₹1,56,170 sent in 18 payouts." Or nothing, before the
 * first payout of the season: the list below says that in its own words.
 */
export function seasonLine(season: SeasonToDate): string | null {
  if (!(season.settlements > 0)) return null;
  const payouts =
    season.settlements === 1 ? "1 payout" : `${season.settlements} payouts`;
  return `Since ${seasonStartLabel(season.from)}: ${formatPaise(
    season.netPaise,
  )} sent in ${payouts}.`;
}

/**
 * The newest payout that has a statement, from a list the API sends newest
 * first. Only a sent one has a statement ("a week locked and not yet sent is
 * listed with its state ... only a sent one has a statement"), so a locked or
 * approved week above it is passed over rather than offered a download that
 * always fails.
 */
export function latestStatement(
  settlements: readonly Settlement[],
): Settlement | null {
  return settlements.find(hasStatement) ?? null;
}

/**
 * The `?cursor=` a "Show more" link carried, or none.
 *
 * Opaque, and the API's to judge: "a cursor this list did not issue is a
 * `400`", which the list already renders as "could not load". This only stops
 * the shapes no cursor ever has (repeated, blank, or long enough to be junk)
 * from reaching the request at all.
 */
export function pageCursor(
  raw: string | string[] | undefined,
): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cursor = raw.trim();
  return cursor !== "" && cursor.length <= 512 ? cursor : undefined;
}

function whole(value: number | undefined): number {
  return Number.isInteger(value) ? (value as number) : 0;
}
