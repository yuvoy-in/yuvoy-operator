/**
 * The one place the country code lives.
 *
 * Every phone field in this portal shows `+91` as fixed furniture and takes
 * ten digits. The operator types what is printed on their own phone; the wire
 * format stays E.164, because the API is strict about it
 * (`^\+[1-9][0-9]{7,14}$`) and every natural variation — `9966440677`,
 * `09966440677`, `+91 99664 40677` — is a rejection at the one moment somebody
 * is trusting the form.
 *
 * ## Why this is a module and not two lines in a component
 *
 * `+91` is right for the Andamans and will be wrong the first time Yuvoy sells
 * anywhere else. Kept here, making the prefix selectable is a change to one
 * object and one component; spread across three forms it is a hunt. Asked for
 * explicitly on yuvoy-operator#19.
 *
 * It is also the seam the tests reach for: the normalisation below is where
 * every paste and every leading zero is decided, and it is pure so those cases
 * can be enumerated without a browser.
 */

export interface Country {
  /** As shown in the field, and as prefixed to the wire value. */
  dialCode: string;
  /** Digits after the dial code. India is ten. */
  nationalDigits: number;
  /** Placeholder digits. Ungrouped, because the field itself is — see below. */
  example: string;
}

export const COUNTRY: Country = {
  dialCode: "+91",
  nationalDigits: 10,
  example: "9876543210",
};

/** The dial code's own digits, for stripping a pasted international number. */
const DIAL_DIGITS = COUNTRY.dialCode.replace(/\D/g, "");

/**
 * Whatever was typed or pasted, as national digits.
 *
 * The order of these steps is load-bearing and each one is a real input:
 *
 * 1. **Non-digits go.** Spaces, brackets, dashes and a leading `+` are how
 *    people write numbers down, not what the field holds.
 * 2. **Leading zeros go**, before the dial code is considered. `09966440677`
 *    is written constantly, and `0919966440677` exists — stripping the zero
 *    first is what lets the next step see the `91`.
 * 3. **A leading `91` goes only when there is more than a national number's
 *    worth of digits left.** The guard is the whole point: `9166440677` is a
 *    real ten-digit number that begins `91`, and an unguarded strip would
 *    silently turn it into somebody else's.
 * 4. **Truncated to ten.** An eleventh keystroke is ignored rather than
 *    sliding the window, so the field never shows a number the operator did
 *    not type.
 */
export function toNationalDigits(input: string): string {
  let digits = input.replace(/\D/g, "").replace(/^0+/, "");
  if (
    digits.length > COUNTRY.nationalDigits &&
    digits.startsWith(DIAL_DIGITS)
  ) {
    digits = digits.slice(DIAL_DIGITS.length);
  }
  return digits.slice(0, COUNTRY.nationalDigits);
}

/** Whether there is a whole number here. What the submit button waits for. */
export function isCompleteNational(digits: string): boolean {
  return digits.length === COUNTRY.nationalDigits;
}

/**
 * The wire value: E.164, always.
 *
 * The `+91` in the field is presentation. A bare ten-digit string is rejected
 * by every auth endpoint, so nothing may post one.
 */
export function toE164(nationalDigits: string): string {
  return `${COUNTRY.dialCode}${nationalDigits}`;
}

/**
 * `98765 43210` — grouped as Indian numbers are read aloud.
 *
 * **Read-only display, and never the input the operator is typing into.** The
 * field is controlled, so re-inserting a space on every keystroke rewrites the
 * value under the caret and any edit that is not at the end throws the caret
 * to the end. Grouping is free on a number being read back and costs the
 * cursor on one being typed, so it is only ever used for the former.
 */
export function formatNational(digits: string): string {
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)} ${digits.slice(5)}`;
}

/** `+91 98765 43210`, for reading back a number somewhere else on screen. */
export function formatE164(e164: string): string {
  const national = toNationalDigits(e164);
  return isCompleteNational(national)
    ? `${COUNTRY.dialCode} ${formatNational(national)}`
    : e164;
}
