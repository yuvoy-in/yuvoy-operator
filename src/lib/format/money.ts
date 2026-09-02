/**
 * Money is `amountMinor`: an integer number of paise.
 *
 * ₹4,500 is `450000`. Never a float, and never divided by hand at a call site
 * — `pnpm qa` fails `amountMinor / 100` anywhere but here, because the one
 * place this appears in the operator portal is a refund total shown to
 * somebody who has just cancelled fourteen people's day, and a number off by
 * a factor of a hundred there is its own emergency.
 */
export function formatPaise(paise: number): string {
  const rupees = Math.round(paise) / 100;
  /*
    Whole rupees show as whole rupees; anything else shows its paise. This
    used to round every line to the rupee, so on the one screen built to be
    reconciled against an operator's own book, four independently-rounded
    lines could visibly fail to add up by ₹1 while the "does not add up"
    guard — which checks raw paise — stayed silent. Integer paise in, the
    exact amount out.
  */
  const whole = Number.isInteger(rupees);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(rupees);
}
