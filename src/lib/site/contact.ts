/**
 * The number an operator rings when the portal cannot help them.
 *
 * ## Why it is written down once
 *
 * It is the way out of every dead end that has no screen: an account with no
 * email to send a sign-in code to, a bank change that went through before
 * anybody stopped it, a document we verified without holding its file. Each
 * of those used to carry the digits as a literal, and a number retyped in five
 * places is a number that is wrong in one of them the day it changes.
 *
 * Two forms because they are two jobs. The display form is what somebody
 * reads aloud or copies onto paper, grouped the way an Indian number is said;
 * the `tel:` form is what a phone dials, with nothing in it but digits.
 *
 * Kept free of anything server-only, because both a Server Action's refusal
 * and a client component's hint render it.
 */
export const SUPPORT_PHONE = "+91 81216 57657";

/** The same number, for a link a phone can dial. */
export const SUPPORT_PHONE_HREF = "tel:+918121657657";
