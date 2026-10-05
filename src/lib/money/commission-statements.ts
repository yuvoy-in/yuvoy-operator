import type { components } from "@/lib/api/schema.gen";
import type { ChipTone } from "@/components/ui/chip";
import { formatPaise } from "@/lib/format/money";
import { marketDate, marketDateLabel } from "@/lib/format/market-time";

export type CommissionStatement = components["schemas"]["CommissionStatement"];
export type CommissionStatementLine =
  components["schemas"]["CommissionStatementLine"];
export type CommissionPayment = components["schemas"]["CommissionPayment"];
export type CommissionPayTo = components["schemas"]["CommissionPayTo"];

/** One statement as its own page reads it: the trips, the payments, where to pay. */
export type CommissionStatementDetail = CommissionStatement & {
  lines: CommissionStatementLine[];
  payments: CommissionPayment[];
  payTo: CommissionPayTo;
};

/**
 * Yuvoy's commission on cash trips, billed weekly (yuvoy-operator#121, D-043).
 *
 * ## Why a bill at all
 *
 * A traveller who pays at the counter pays the business, so the business
 * holds Yuvoy's share and there is no payout for it to come out of. From the
 * Tuesday after each Monday to Sunday week the API issues a statement for the
 * cash trips of that week, and the owners are emailed. The business pays it
 * by UPI, and Yuvoy's staff record the payment once the money arrives: the
 * portal never posts anything.
 *
 * ## The two figures that both say "owed"
 *
 * `GET /commission-owed` sums the share on EVERY completed cash trip, billed
 * or not, paid or not ("What is owed here is every such trip"). A statement's
 * `owedPaise` is what is still to pay on it. So wherever a screen says what
 * is owed, it is the statements' figure (`totalOwed`), and the cash figures
 * say what they are: Yuvoy's share on completed trips.
 */

/**
 * A statement's state, as an operator reads it.
 *
 * `waived` reads as settled: Yuvoy chose not to collect what was left, and
 * nothing more is owed on it. The two states with something still to pay
 * take the accent, because they are the ones that need doing.
 */
const STATE: Record<
  CommissionStatement["state"],
  { label: string; tone: ChipTone }
> = {
  issued: { label: "To pay", tone: "accent" },
  part_paid: { label: "Part paid", tone: "accent" },
  paid: { label: "Paid", tone: "neutral" },
  waived: { label: "Settled", tone: "neutral" },
};

/**
 * The chip for a statement, narrowed where it enters.
 *
 * An enum says what the API will send, not what a deployed one does. A state
 * this portal has never heard of is drawn from what is owed on it, which is
 * the one thing the chip is for, rather than as a blank.
 */
export function statementState(
  statement: Pick<CommissionStatement, "state" | "owedPaise">,
): { label: string; tone: ChipTone } {
  const known = STATE[statement.state as CommissionStatement["state"]];
  if (known) return known;
  return (owedOf(statement) ?? 0) > 0 ? STATE.issued : STATE.paid;
}

/**
 * What is still to pay on one statement, or `null` when it does not say.
 *
 * A waived statement owes nothing whatever its figures read: "0 once the
 * statement is waived". A figure that is not a whole number of paise is not
 * an answer, and is never drawn as ₹0.
 */
export function owedOf(
  statement: Pick<CommissionStatement, "state" | "owedPaise">,
): number | null {
  if (statement.state === "waived") return 0;
  return Number.isInteger(statement.owedPaise) && statement.owedPaise >= 0
    ? statement.owedPaise
    : null;
}

/**
 * What is owed now across every statement: the figure behind "owed".
 *
 * `null` when any statement will not say what it owes, or the list was cut
 * short: a total missing a statement understates a bill, and an operator who
 * pays it believes they are square.
 */
export function totalOwed(
  statements: readonly Pick<CommissionStatement, "state" | "owedPaise">[],
  complete = true,
): number | null {
  if (!complete) return null;
  let total = 0;
  for (const statement of statements) {
    const owed = owedOf(statement);
    if (owed === null) return null;
    total += owed;
  }
  return total;
}

/** How many statements still have something to pay on them. */
export function statementsOwing(
  statements: readonly Pick<CommissionStatement, "state" | "owedPaise">[],
): number {
  return statements.filter((s) => (owedOf(s) ?? 0) > 0).length;
}

/**
 * The statements the Money tab lists, from a list the API sends newest first.
 *
 * Every statement with something still to pay, however old, then the newest
 * settled ones until `max` rows are drawn, in the API's order. A bill is
 * never pushed off the tab by a newer one that is already paid, and the rest
 * are one tap away on the full list.
 */
export function statementsForMoney<
  T extends Pick<CommissionStatement, "state" | "owedPaise">,
>(statements: readonly T[], max = 4): { shown: T[]; more: number } {
  const owing = statements.filter((s) => (owedOf(s) ?? 0) > 0).length;
  let settledRoom = Math.max(0, max - owing);
  const shown = statements.filter((s) => {
    if ((owedOf(s) ?? 0) > 0) return true;
    if (settledRoom === 0) return false;
    settledRoom -= 1;
    return true;
  });
  return { shown, more: statements.length - shown.length };
}

/**
 * The `upi://pay` link to open, or `null`.
 *
 * Only that scheme, checked here: an `href` drawn from a response is a link
 * somebody taps with money in mind, and a `javascript:` or web URL in its
 * place must never become a button.
 *
 * And only a link that pays what the screen says, to whom it says. The button
 * reads "Pay ₹2,250 by UPI" from the statement and the UPI ID beside it is
 * `payTo.upiId`; a link whose `pa` or `am` disagrees would open a UPI app on a
 * different payee or amount from the one the operator just read. Without a
 * usable link the UPI ID and the payee are still shown, which is how somebody
 * paying from another phone or a computer pays anyway.
 */
export function upiPayLink(
  payTo: Pick<CommissionPayTo, "available" | "upiLink" | "upiId">,
  owedPaise: number,
): string | null {
  if (!payTo.available) return null;
  const link = payTo.upiLink?.trim();
  if (!link || !/^upi:\/\/pay\?\S+$/i.test(link)) return null;

  const params = new URLSearchParams(link.slice(link.indexOf("?") + 1));
  const pa = params.get("pa")?.trim().toLowerCase();
  if (!pa || pa !== payTo.upiId?.trim().toLowerCase()) return null;
  // An amount is optional in a UPI link; one that is there must be this one.
  const am = params.get("am");
  if (am !== null && rupeesToPaise(am) !== owedPaise) return null;
  return link;
}

/** "2250.00" as 225000, or `null` when it is not an amount in rupees. */
function rupeesToPaise(rupees: string): number | null {
  const amount = rupees.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  return Math.round(Number(amount) * 100);
}

/**
 * Where to pay, when the API has it: the UPI ID and payee, both present.
 *
 * `available: true` promises both. One missing is not a payee anybody can
 * pay, so it is treated as not set up rather than drawn half-empty.
 */
export function payee(
  payTo: Pick<CommissionPayTo, "available" | "upiId" | "payee">,
): { upiId: string; name: string } | null {
  const upiId = payTo.upiId?.trim();
  const name = payTo.payee?.trim();
  return payTo.available && upiId && name ? { upiId, name } : null;
}

/** "15%", "12.5%": the rate frozen on a booking, from basis points. */
export function rateLabel(bps: number): string {
  if (!Number.isFinite(bps)) return "";
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(bps / 100)}%`;
}

/** "3 trips". */
export function tripsLabel(bookings: number): string {
  return bookings === 1 ? "1 trip" : `${bookings} trips`;
}

/**
 * Whether the trips on a statement account for what it bills.
 *
 * The statement copies its lines when it is issued, so they should always
 * agree. When they do not, the screen says so rather than letting somebody
 * find it with a calculator and stop trusting the bill.
 */
export function statementLinesAddUp(
  statement: Pick<CommissionStatementDetail, "bookings" | "commissionPaise">,
  lines: readonly Pick<CommissionStatementLine, "commissionPaise">[],
): boolean {
  if (lines.length !== statement.bookings) return false;
  const summed = lines.reduce((n, l) => n + l.commissionPaise, 0);
  return summed === statement.commissionPaise;
}

/** Whether the payments listed account for what is recorded as paid. */
export function paymentsAddUp(
  statement: Pick<CommissionStatementDetail, "paidPaise">,
  payments: readonly Pick<CommissionPayment, "amountPaise">[],
): boolean {
  const summed = payments.reduce((n, p) => n + p.amountPaise, 0);
  return summed === statement.paidPaise;
}

/**
 * The line under a statement's week on its own page: where it stands.
 *
 * Dates are the market's calendar day. `issuedAt` and `waivedAt` are
 * instants, so they are read as a day in the market before they are written.
 */
export function statementStateLine(
  statement: Pick<
    CommissionStatement,
    "state" | "owedPaise" | "issuedAt" | "waivedAt"
  >,
): string {
  switch (statement.state) {
    case "issued": {
      const on = dayOf(statement.issuedAt);
      return on ? `Issued on ${on}. Nothing paid yet.` : "Nothing paid yet.";
    }
    case "part_paid": {
      const owed = owedOf(statement);
      return owed !== null
        ? `Part paid. ${formatPaise(owed)} still to pay.`
        : "Part paid.";
    }
    case "paid":
      return "Paid in full.";
    case "waived": {
      const on = dayOf(statement.waivedAt);
      return on
        ? `Settled on ${on}. Nothing more to pay.`
        : "Settled. Nothing more to pay.";
    }
    default:
      return statementState(statement).label;
  }
}

/** An instant as the market's calendar day, "29 September 2026", or `null`. */
function dayOf(at: string | undefined): string | null {
  const ms = at ? Date.parse(at) : NaN;
  return Number.isNaN(ms) ? null : marketDateLabel(marketDate(new Date(ms)));
}
