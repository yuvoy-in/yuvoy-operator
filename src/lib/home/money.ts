import { formatPaise } from "@/lib/format/money";
import { daysBetween, shortDate } from "./words";

/**
 * Money today, in one line (yuvoy-operator#96 block 4).
 *
 * "This week ₹X · next payout Mon 28 Sep · cash owed to Yuvoy ₹2,250", from
 * `GET /settlements/overview` and `GET /commission-owed`. Managers only: every
 * money read refuses STAFF, so a staff login never asks.
 *
 * ## What each part is, exactly
 *
 *   - The week is `nextSettlement`, which is LAST week while nobody has
 *     locked it and it has bookings to pay, and this week otherwise. So it is
 *     named for which week it is, never "this week" by default: a figure for
 *     last week called this week's is a figure somebody plans against.
 *   - The payout day is `settlesFrom`, the Monday it can first be sent, and
 *     it is said as "from": three people at Yuvoy send it on that day or
 *     after, and a bank decides when it lands. Once that day has come it is
 *     "due".
 *   - Cash owed is `commissionPaise`: what is owed NOW, on completed cash
 *     trips whose cash was recorded. Zero is not news and is left out.
 *
 * ## What is deliberately not here
 *
 * No "cash still to run" figure built on `paidAtCounter.bookings`. That count
 * used to carry past cash trips with nothing recorded as though they were
 * still to come (7 trips, ₹60,000, on a morning with nothing upcoming), which
 * the issue rules out and yuvoy-api#221 fixed by counting them apart. They are
 * a row in "Needs you" instead, where somebody can close them.
 */

export interface MoneyWeek {
  periodStart: string;
  periodEnd: string;
  settlesFrom: string;
  netPaise: number;
}

export interface MoneyLine {
  text: string;
  /** The week pays less than nothing: a correction larger than it earned. */
  owedBack: boolean;
}

/** Which week a payout week is, from the market's today. */
function weekName(week: MoneyWeek, today: string): string {
  if (week.periodStart <= today && today <= week.periodEnd) return "This week";
  if (week.periodEnd < today) {
    // Last week ended on the Sunday before this week's Monday.
    const since = daysBetween(week.periodEnd, today);
    if (since !== null && since <= 7) return "Last week";
    const start = shortDate(week.periodStart);
    return start ? `Week of ${start}` : "Last week";
  }
  return "Next week";
}

export function moneyLine(input: {
  /** `null` when the overview did not answer. */
  week: MoneyWeek | null;
  /** What is owed on cash now; `null` when it did not answer. */
  owedPaise: number | null;
  /** The market's today, `YYYY-MM-DD`. */
  today: string;
}): MoneyLine | null {
  const parts: string[] = [];
  let owedBack = false;

  if (input.week) {
    const { week } = input;
    parts.push(`${weekName(week, input.today)} ${formatPaise(week.netPaise)}`);
    owedBack = week.netPaise < 0;
    const from = shortDate(week.settlesFrom);
    if (from) {
      parts.push(
        week.settlesFrom <= input.today ? "payout due" : `payout from ${from}`,
      );
    }
  }
  if (input.owedPaise !== null && input.owedPaise > 0) {
    parts.push(`cash owed to Yuvoy ${formatPaise(input.owedPaise)}`);
  }

  if (parts.length === 0) {
    // Both reads failed, or the only answer was nothing owed: say the week
    // is quiet only when a read actually said so.
    return input.week === null && input.owedPaise === null
      ? null
      : { text: "Nothing owed on cash", owedBack: false };
  }
  const text = parts.join(" · ");
  return { text: text.charAt(0).toUpperCase() + text.slice(1), owedBack };
}
