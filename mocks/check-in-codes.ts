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

/**
 * Codes that answer a refusal no booking above can, so the screens for them
 * show in a local or end-to-end run: another day (409 with
 * `details.validOn`), too many misses (429) and paused (503). The sentences
 * are `host_check_in.go`'s at a53d7b3a.
 */
export const CHECK_IN_REFUSAL_CODES = {
  TMRW2345: "not_today",
  MANY2345: "too_many",
  PAUS2345: "paused",
} as const;

export interface MockCheckInRefusal {
  code: string;
  message: string;
  status: number;
  details?: { validOn: string };
}

export function mockCheckInRefusal(
  code: string,
  now = Date.now(),
): MockCheckInRefusal | null {
  const kind =
    CHECK_IN_REFUSAL_CODES[code as keyof typeof CHECK_IN_REFUSAL_CODES];
  switch (kind) {
    case "not_today": {
      // Tomorrow in India, said as the API says it: "Mon 2 Jan", no year.
      const tomorrow = new Date(now + 86_400_000);
      const validOn = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
      }).format(tomorrow);
      const said = new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(new Date(`${validOn}T00:00:00Z`));
      return {
        code: "check_in_not_today",
        message: `This code is for ${said}.`,
        status: 409,
        details: { validOn },
      };
    }
    case "too_many":
      return {
        code: "rate_limited",
        message:
          "Too many codes did not match. Check people in by name for now.",
        status: 429,
      };
    case "paused":
      return {
        code: "check_in_paused",
        message: "Check-in by code is paused. Use Aboard.",
        status: 503,
      };
    default:
      return null;
  }
}

/** As `invite.Normalise`: case, spaces, tabs and hyphens do not count. */
export function mockNormaliseCode(typed: string): string {
  return typed.replace(/[\s-]/g, "").toUpperCase();
}
