/**
 * What this portal accepts as an email address. One rule, for every form that
 * asks for one: creating an account, and inviting somebody onto a team.
 *
 * ## Why the API's rule and not a stricter one
 *
 * It is the expression yuvoy-api applies to an invitation's address
 * (`inviteEmail`, "the same expression internal/lead applies to a traveller's
 * address"): a name, one `@`, and a domain with a dot in it. Mirroring it means
 * a form here never refuses an address the server would take, which a stricter
 * library check would, and never sends one it refuses, which would come back as
 * a `400` after a round trip on one bar of signal.
 *
 * What it rejects is a typo, and that is the whole job. A typo in an address a
 * code is emailed to is a code nobody receives, with nothing on the screen to
 * say so; nothing here can tell whether an address that LOOKS right belongs to
 * anybody, and it does not pretend to.
 *
 * ## Why the length is checked too
 *
 * 254 characters is the most an address can be, and the API refuses anything
 * longer with the same `400` as a malformed one.
 */
const EMAIL = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

/** The longest address the API takes. */
export const EMAIL_MAX_LENGTH = 254;

/** Whether `value`, already trimmed, is an address the API would take. */
export function looksLikeEmail(value: string): boolean {
  return value.length <= EMAIL_MAX_LENGTH && EMAIL.test(value);
}
