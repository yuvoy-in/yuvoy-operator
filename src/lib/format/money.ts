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
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Math.round(paise) / 100);
}
