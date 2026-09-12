import { formatPaise } from "@/lib/format/money";

/**
 * Taking less than the fare, said BEFORE it is recorded — yuvoy-operator#40 §1.
 *
 * A collection "reported once is a fact": the API answers every later report
 * with the first one and never overwrites the amount. So the shortfall the
 * response carries afterwards can only ever show a mis-key — 300 typed for
 * 3000 — once it is permanent. This module is the half that shows it while
 * the box is still open, from the fare the row already holds, and refuses the
 * one amount the API would refuse outright: more than the fare.
 *
 * Pure, so the "took less" box and its Server Action read the same rules.
 */

/** Seven digits: ₹99,99,999 is past any fare on the islands, and past a typo. */
const WHOLE_RUPEES = /^\d{1,7}$/;

/**
 * Whole rupees as a person types them — commas, spaces and a ₹ sign tolerated
 * — in paise, or `null`. Decimals are refused rather than rounded: nobody hands
 * over paise at a jetty, and a stray `.` is far likelier a slip than a price.
 */
export function rupeesToPaise(typed: string): number | null {
  const digits = typed.replace(/[,\s₹]/g, "");
  if (!WHOLE_RUPEES.test(digits)) return null;
  return Number(digits) * 100;
}

export type FareComparison =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "more"; farePaise: number }
  | { kind: "whole"; farePaise: number }
  | { kind: "less"; farePaise: number; shortPaise: number }
  | { kind: "nothing"; farePaise: number }
  | { kind: "unknown-fare"; paise: number };

export function compareToFare(
  typed: string,
  farePaise: number | null,
): FareComparison {
  if (typed.trim() === "") return { kind: "empty" };
  const paise = rupeesToPaise(typed);
  if (paise === null) return { kind: "invalid" };
  if (farePaise === null) return { kind: "unknown-fare", paise };
  if (paise > farePaise) return { kind: "more", farePaise };
  if (paise === farePaise) return { kind: "whole", farePaise };
  // `0` is a real answer — "they turned up and I waved them on" — and a
  // different statement from not saying, so it gets its own sentence.
  if (paise === 0) return { kind: "nothing", farePaise };
  return { kind: "less", farePaise, shortPaise: farePaise - paise };
}

/** The sentence under the box. Never "paid": they were paid, we were not. */
export function fareComparisonText(comparison: FareComparison): string {
  switch (comparison.kind) {
    case "empty":
      return "Type what you took, in whole rupees.";
    case "invalid":
      return "Whole rupees, digits only.";
    case "more":
      return `That is more than the fare of ${formatPaise(comparison.farePaise)}. We cannot record more than the fare.`;
    case "whole":
      return "That is the whole fare, the same as Cash taken.";
    case "less":
      return `That is ${formatPaise(comparison.shortPaise)} less than the fare of ${formatPaise(comparison.farePaise)}.`;
    case "nothing":
      return `That records nothing taken, the whole ${formatPaise(comparison.farePaise)} short.`;
    case "unknown-fare":
      return "The fare did not load, so check this against what they owe before you record it.";
  }
}

/** Whether the box holds something the API will accept. */
export function canRecordAmount(comparison: FareComparison): boolean {
  return (
    comparison.kind === "less" ||
    comparison.kind === "whole" ||
    comparison.kind === "nothing" ||
    comparison.kind === "unknown-fare"
  );
}
