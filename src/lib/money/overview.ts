import { formatPaise } from "@/lib/format/money";
import { cashInHand, type Commission } from "./commission";
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
 * zero: "₹0 owed" drawn from a failed read tells an operator with a balance
 * that they owe nothing.
 */
export interface CashOnTheTab {
  /** All the cash recorded taken, owed and held together, as Cash leads with it. */
  inHand: number | null;
  /** Yuvoy's share on completed cash trips, owed now. */
  owedNow: number | null;
  /** Yuvoy's share on cash taken for trips still to run: owed once they run. */
  heldShare: number | null;
  /** Cash bookings still to run, paid or not. */
  toRun: { bookings: number; farePaise: number };
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

  return {
    inHand: commission ? cashInHand(commission) : null,
    owedNow: commission ? commission.commissionPaise : null,
    heldShare: commission?.held ? commission.held.commissionPaise : null,
    toRun: {
      bookings: whole(counter.bookings),
      farePaise: whole(counter.farePaise),
    },
    unrecorded: unrecorded && unrecorded.bookings > 0 ? unrecorded : null,
  };
}

/** Whether there is any cash to speak of: taken, owed, to take, or unrecorded. */
export function cashHasMoney(cash: CashOnTheTab): boolean {
  return (
    (cash.inHand ?? 0) > 0 ||
    (cash.owedNow ?? 0) > 0 ||
    (cash.heldShare ?? 0) > 0 ||
    cash.toRun.bookings > 0 ||
    cash.unrecorded !== null
  );
}

/**
 * The top of the Money tab, in the order it is drawn.
 *
 *   - `payout`       the next payout's card, with its arithmetic
 *   - `booked`       card bookings still to run, never earned
 *   - `cash`         cash held and owed, with the door to Cash
 *   - `payout-quiet` the next payout said in words, below the real blocks,
 *                    when it has nothing in it ("keep the settlement card, but
 *                    below")
 *   - `nothing-yet`  one sentence, when not one block has money in it
 *
 * The real blocks keep their order among themselves: what Yuvoy will pay,
 * then what is booked, then cash. An empty block is never drawn as a ₹0.
 */
export type MoneyBlock =
  "payout" | "booked" | "cash" | "payout-quiet" | "nothing-yet";

export function moneyBlocks(
  week: Pick<SettlementWeek, "bookings" | "netPaise">,
  pipeline: Pick<SettlementPipeline, "bookings" | "netPaise">,
  cash: CashOnTheTab,
): MoneyBlock[] {
  const blocks: MoneyBlock[] = [];
  if (payoutHasMoney(week)) blocks.push("payout");
  if (pipelineHasMoney(pipeline)) blocks.push("booked");
  if (cashHasMoney(cash)) blocks.push("cash");
  if (blocks.length === 0) return ["nothing-yet"];
  if (!blocks.includes("payout")) blocks.push("payout-quiet");
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
