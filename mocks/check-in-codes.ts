/**
 * The check-in code on each booking a traveller could show at the jetty
 * (yuvoy-operator#175), for `POST /check-ins` in the mock.
 *
 * Codes are written in `invite.Alphabet` as the API issues them. Asha has not
 * arrived yet, so her code checks her in; Daniel arrived at 06:31, so his
 * answers `alreadyCheckedIn` with that time.
 */
export const CHECK_IN_CODES: Readonly<Record<string, string>> = {
  K7QM2XPA: "bkg_1",
  R4TW9HNE: "bkg_2",
};

/** As `invite.Normalise`: case, spaces, tabs and hyphens do not count. */
export function mockNormaliseCode(typed: string): string {
  return typed.replace(/[\s-]/g, "").toUpperCase();
}
