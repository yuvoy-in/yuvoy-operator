/**
 * A listing's price as an operator types it, in integer paise:
 * yuvoy-operator#144.
 *
 * The builder read the price box by deleting everything but digits and dots.
 * That keeps every dot, so "Rs. 1500" read as ".1500" and the listing was
 * saved at 15 paise, ten thousand times less than was typed; "1500-2000" read
 * as 15002000; and "1.005" passed for a price. So only the shapes a price is
 * written in are read, and anything else is refused rather than read as some
 * other number. "Check the price." costs a second; a wrong figure goes out on
 * a traveller's card.
 *
 * The mobile operator app reads a price by the same rules
 * (`priceTextToPaise`), so one typed price is one price on both. This side
 * refuses two inputs the phone reads as a different number: commas that do
 * not group, so "15,00" (15 rupees with a decimal comma) is not read as 1,500;
 * and a space inside the number, so "1500 2000" is not read as 15002000.
 *
 * Pure, so the step's "You receive" line and its Server Action read a price
 * the same way.
 */

/** An optional "Rs", "Rs.", "INR" or "₹" before the amount, and any space after it. */
const PREFIX = /^(?:rs\.?|inr|₹)\s*/i;

/**
 * Whole rupees, ungrouped ("150000"), in Western groups ("150,000") or in
 * Indian ones ("1,50,000"), then at most two decimals.
 */
const AMOUNT =
  /^(\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.(\d{0,2}))?$/;

/**
 * Typed rupees in paise, or `null` for anything that is not a price above
 * zero. Built from the digits as whole numbers, never through a fraction, so
 * a price cannot arrive a paisa off.
 */
export function priceToPaise(typed: string): number | null {
  const amount = AMOUNT.exec(typed.trim().replace(PREFIX, ""));
  if (!amount) return null;
  const [, whole, decimals = ""] = amount;
  const paise =
    Number(whole.replace(/,/g, "")) * 100 + Number(decimals.padEnd(2, "0"));
  return Number.isSafeInteger(paise) && paise > 0 ? paise : null;
}

/**
 * Paise as the price box starts: "1500" for whole rupees, "1500.50" for
 * anything else, and "" for no price. `priceToPaise` reads it back as the same
 * number, so pressing Next without touching the price never changes it. The
 * box used to start rounded to whole rupees, which re-priced a listing at
 * ₹1,500.50 to ₹1,501 the next time anybody saved the step.
 */
export function paiseToPriceText(paise: number | null | undefined): string {
  if (typeof paise !== "number" || !Number.isSafeInteger(paise) || paise <= 0) {
    return "";
  }
  const rest = paise % 100;
  const rupees = (paise - rest) / 100;
  return rest === 0
    ? String(rupees)
    : `${rupees}.${String(rest).padStart(2, "0")}`;
}
