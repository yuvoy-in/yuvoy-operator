import { describe, expect, it } from "vitest";
import {
  CHECK_IN_REFUSAL_CODES,
  mockCheckInRefusal,
} from "../../../mocks/check-in-codes";

/*
  The mock's refusal codes (yuvoy-operator#175), so the another-day, too
  many and paused screens show in a local run. Each answers as
  host_check_in.go does at a53d7b3a.
*/

describe("mock check-in refusals", () => {
  it("dates the another-day code tomorrow in India, as the API says it", () => {
    // 3 Nov 2026 22:00 in India is 16:30 UTC; tomorrow there is 4 Nov.
    const now = Date.UTC(2026, 10, 3, 16, 30);
    expect(mockCheckInRefusal("TMRW2345", now)).toEqual({
      code: "check_in_not_today",
      message: "This code is for Wed 4 Nov.",
      status: 409,
      details: { validOn: "2026-11-04" },
    });
  });

  it("answers too many with 429 and paused with 503", () => {
    expect(mockCheckInRefusal("MANY2345")).toMatchObject({
      code: "rate_limited",
      status: 429,
    });
    expect(mockCheckInRefusal("PAUS2345")).toMatchObject({
      code: "check_in_paused",
      status: 503,
      message: "Check-in by code is paused. Use Aboard.",
    });
  });

  it("leaves every other code to the bookings", () => {
    expect(mockCheckInRefusal("K7QM2XPA")).toBeNull();
    for (const code of Object.keys(CHECK_IN_REFUSAL_CODES)) {
      expect(code).toMatch(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
    }
  });
});
