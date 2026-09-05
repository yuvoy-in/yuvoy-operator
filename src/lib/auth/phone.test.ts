import { describe, expect, it } from "vitest";
import {
  COUNTRY,
  formatE164,
  formatNational,
  isCompleteNational,
  toE164,
  toNationalDigits,
} from "./phone";

describe("toNationalDigits", () => {
  it("keeps a plain ten-digit number", () => {
    expect(toNationalDigits("9966440677")).toBe("9966440677");
  });

  it("strips the punctuation people write numbers with", () => {
    for (const written of [
      "99664 40677",
      "99664-40677",
      "(99664) 40677",
      " 9966440677 ",
    ]) {
      expect(toNationalDigits(written)).toBe("9966440677");
    }
  });

  it("drops a leading zero, which people write constantly", () => {
    expect(toNationalDigits("09966440677")).toBe("9966440677");
  });

  it("takes the national part out of a pasted international number", () => {
    for (const pasted of [
      "+919966440677",
      "919966440677",
      "+91 99664 40677",
      "+91-99664-40677",
    ]) {
      expect(toNationalDigits(pasted)).toBe("9966440677");
    }
  });

  it("strips a zero before the dial code, not only instead of it", () => {
    // `0919966440677` exists in the wild. Stripping the zero FIRST is what
    // lets the dial-code step see the 91 at all.
    expect(toNationalDigits("0919966440677")).toBe("9966440677");
  });

  /*
    The one that would silently dial a stranger.

    `9166440677` is a real ten-digit number that begins `91`. An unguarded
    "strip the dial code" turns it into `66440677` — eight digits, accepted by
    nothing, or worse, padded by a later keystroke into somebody else's number.
  */
  it("does not mistake a number that begins 91 for a dial code", () => {
    expect(toNationalDigits("9166440677")).toBe("9166440677");
    expect(toNationalDigits("+919166440677")).toBe("9166440677");
  });

  it("ignores an eleventh digit rather than sliding the window", () => {
    // Typing past ten must not change the digits already shown — a field that
    // rewrites what is on screen mid-type is a field nobody trusts.
    expect(toNationalDigits("99664406779")).toBe("9966440677");
  });

  it("is empty for nothing, and for text", () => {
    expect(toNationalDigits("")).toBe("");
    expect(toNationalDigits("call me")).toBe("");
    expect(toNationalDigits("0")).toBe("");
  });

  /*
    The consequence of the guard above, and it has to be this way round.

    Somebody typing `9166440677` passes through `9`, `91`, `916`… — so a bare
    `91` MUST be kept as two digits of a number in progress. Stripping it as a
    dial code would make every number beginning 91 impossible to type, one
    keystroke in. `+91` pasted alone is nonsense either way; incomplete is the
    right answer to it, and the submit stays disabled.
  */
  it("keeps a bare 91, because it is two digits of a number in progress", () => {
    expect(toNationalDigits("91")).toBe("91");
    expect(toNationalDigits("+91")).toBe("91");
    expect(isCompleteNational(toNationalDigits("+91"))).toBe(false);
  });

  it("is idempotent — running it on its own output changes nothing", () => {
    // It runs on every keystroke and on the value handed back after a refusal.
    for (const input of ["+919966440677", "09966440677", "9966440677"]) {
      const once = toNationalDigits(input);
      expect(toNationalDigits(once)).toBe(once);
    }
  });
});

describe("isCompleteNational", () => {
  it("is true at exactly the country's length", () => {
    expect(isCompleteNational("9966440677")).toBe(true);
    expect(isCompleteNational("996644067")).toBe(false);
    expect(isCompleteNational("")).toBe(false);
  });
});

describe("toE164", () => {
  it("is what goes on the wire, never the bare digits", () => {
    expect(toE164("9966440677")).toBe("+919966440677");
  });

  it("produces something the API's own pattern accepts", () => {
    // `^\+[1-9][0-9]{7,14}$`, from the contract. A bare ten-digit string is
    // rejected, which is the whole reason the field and the wire differ.
    const API = /^\+[1-9]\d{7,14}$/;
    expect(API.test(toE164("9966440677"))).toBe(true);
    expect(API.test("9966440677")).toBe(false);
  });
});

describe("formatting", () => {
  it("groups as an Indian number is read aloud", () => {
    expect(formatNational("9966440677")).toBe("99664 40677");
    expect(formatNational("99664")).toBe("99664");
    expect(formatNational("996")).toBe("996");
  });

  it("reads an E.164 number back with its dial code", () => {
    expect(formatE164("+919966440677")).toBe("+91 99664 40677");
  });

  it("hands back anything it cannot parse, rather than mangling it", () => {
    // A number from another country would arrive here one day. Showing it
    // unchanged is honest; forcing it into an Indian shape is not.
    expect(formatE164("+15551234")).toBe("+15551234");
  });
});

describe("the country lives in one place", () => {
  it("drives the length and the prefix together", () => {
    // If `COUNTRY` changes, these move with it rather than being restated —
    // yuvoy-operator#19 asked for the prefix to be one edit, not a hunt.
    expect(toE164("1".repeat(COUNTRY.nationalDigits))).toBe(
      `${COUNTRY.dialCode}${"1".repeat(COUNTRY.nationalDigits)}`,
    );
    expect(isCompleteNational("1".repeat(COUNTRY.nationalDigits))).toBe(true);
  });
});
