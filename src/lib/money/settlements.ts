import type { components } from "@/lib/api/schema.gen";
import { marketDate, marketDateLabel } from "@/lib/format/market-time";

export type Settlement = components["schemas"]["Settlement"];
export type SettlementLine = components["schemas"]["SettlementLine"];
export type SettlementWeek = components["schemas"]["SettlementWeek"];
export type SettlementPipeline = components["schemas"]["SettlementPipeline"];
export type PaidAtCounter = components["schemas"]["PaidAtCounter"];
export type SeasonToDate = components["schemas"]["SeasonToDate"];

/**
 * What a payout is, said in an operator's words (yuvoy-operator#47).
 *
 * ## The one rule this file exists to hold
 *
 * **The pipeline is never earned.** `pipeline.netPaise` is card bookings still
 * to run, and the contract says it "is **never** part of anything earned". An
 * operator who reads a pipeline figure inside a total believes they are owed
 * money for trips that have not happened, and will chase us for it.
 *
 * So there is no function here that sums a week and a pipeline, and the screen
 * renders the pipeline in its own block with its own sentence. `qa` check
 * enforces the same thing from the other side: nothing may add `pipeline` to a
 * settlement figure.
 *
 * ## Why the labels are here and not inline
 *
 * A settlement's `state` is three words to us and three different promises to
 * an operator: `locked` means the number is fixed and nobody has approved it,
 * `approved` means it is queued, `settled` means the bank has been told. Only
 * the last has a statement, and only the last has a reference. Getting
 * `approved` and `settled` the wrong way round tells somebody money has moved
 * when it has not.
 */

/** A settlement's state, as an operator reads it. */
export const SETTLEMENT_STATE_LABEL: Record<Settlement["state"], string> = {
  locked: "Locked",
  approved: "Approved",
  settled: "Paid",
};

/**
 * A payout's state as the line under its heading on its own page: what has
 * happened, and what it is waiting for.
 *
 * The list rows say "Paid", "Approved" or "Locked", which is enough beside a
 * figure; on the week's own page the word is the heading's only context, and
 * "Locked" alone does not say whether anybody still has to act. The paid date
 * is the market's calendar day, formatted here on the server.
 */
export function stateLine(
  settlement: Pick<Settlement, "state" | "settledAt">,
): string {
  switch (settlement.state) {
    case "settled": {
      const at = settlement.settledAt ? Date.parse(settlement.settledAt) : NaN;
      return Number.isNaN(at)
        ? "Paid"
        : `Paid on ${marketDateLabel(marketDate(new Date(at)))}`;
    }
    case "approved":
      return "Approved, waiting to be sent";
    case "locked":
      return "Locked, waiting to be approved";
  }
}

/**
 * Whether this settlement has a statement to download.
 *
 * `settled` only. The contract is explicit that "a week locked and not yet sent
 * is listed with its state, because its number is fixed; only a sent one has a
 * statement", and the endpoint answers `409 not_settled` otherwise. Offering
 * the button earlier would be a download that always fails.
 */
export function hasStatement(settlement: Pick<Settlement, "state">): boolean {
  return settlement.state === "settled";
}

/**
 * A figure that may legitimately be below zero.
 *
 * `netPaise` on a week goes negative when a correction is larger than what the
 * week pays: "that week is not paid until somebody at Yuvoy decides how to
 * recover it." The minus sign is the whole message, so nothing here clamps,
 * absolutes or hides it, and the screen must not either.
 *
 * Returned as a flag rather than styled here, because a colour is the design
 * system's decision and a sign is not.
 */
export function isOwedBack(netPaise: number): boolean {
  return netPaise < 0;
}

/**
 * Whether to draw the adjustments line at all.
 *
 * "Show adjustments only when they are not 0." A zero correction is not news,
 * and a row reading "Adjustments ₹0" on every payout trains an operator to
 * stop reading the block that occasionally says something important.
 */
export function showsAdjustments(adjustmentsPaise: number): boolean {
  return adjustmentsPaise !== 0;
}

/**
 * "Mon 8 Sep to Sun 14 Sep".
 *
 * Built from parts rather than taken from the locale's own joining, for the
 * same reason the app's day labels are: `en-IN` emits "Mon, 8 Sept" with a
 * comma and a four-letter September, and this has to read as one span.
 *
 * Dates are parsed at noon in the market. A payout week is Monday to Sunday
 * "in your market's clock", and a bare date read as UTC midnight is the
 * previous evening there, which would name every boundary a day early.
 */
export function weekLabel(periodStart: string, periodEnd: string): string {
  return `${dayWithWeekday(periodStart)} to ${dayWithWeekday(periodEnd)}`;
}

/** "Mon 8 Sep". */
export function dayWithWeekday(date: string): string {
  const parts = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kolkata",
  }).formatToParts(new Date(`${date}T12:00:00+05:30`));
  const at = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${at("weekday")} ${at("day")} ${at("month").slice(0, 3)}`;
}

/** "Monday 15 September", for the sentence about when a payout can be sent. */
export function longDay(date: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Kolkata",
  })
    .format(new Date(`${date}T12:00:00+05:30`))
    .replace(",", "");
}

/** "1 April 2026", for "Since {from}". */
export function seasonStartLabel(from: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(`${from}T12:00:00+05:30`));
}

/**
 * The sentence under the next settlement's figures.
 *
 * Two claims, and both are deliberately hedged because both are outside our
 * control: three people at Yuvoy lock, approve and send a week, and the bank
 * decides when it lands. "At the earliest" and "can still change" are what
 * stop this reading as a promise of a date.
 */
export function nextSettlementNote(settlesFrom: string): string {
  return `Paid from ${longDay(settlesFrom)} at the earliest. These figures can still change.`;
}

/**
 * The filename for a downloaded statement.
 *
 * `Content-Disposition` is the server's to decide and is used when it gives
 * one. The fallback names the period rather than the id, because a folder of
 * `statement-01J8ZQ.csv` files is unsearchable and an operator reconciling a
 * quarter is looking for a week.
 */
export function statementFilename(
  disposition: string | null,
  settlement: Pick<Settlement, "id" | "periodStart" | "periodEnd">,
): string {
  const quoted = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(
    disposition ?? "",
  );
  const named = quoted?.[1]?.trim();
  /*
    A server-supplied name is used only when it is a plain filename. A
    `Content-Disposition` carrying a path is how a download escapes its folder,
    and this string reaches a save dialog.
  */
  if (
    named &&
    !named.includes("/") &&
    !named.includes("\\") &&
    named !== ".."
  ) {
    return named;
  }
  return `yuvoy-statement-${settlement.periodStart}-to-${settlement.periodEnd}.csv`;
}
