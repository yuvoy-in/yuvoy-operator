import { describe, it, expect } from "vitest";
import {
  RIGHTS_STATEMENT,
  WITHDRAW_REASONS,
  isWithdrawReason,
  RIGHTS_TYPES,
  STATEMENT_VERSION,
  isRightsType,
  rightsProblem,
  sha256Hex,
  type RightsInput,
} from "./rights";

const input = (over: Partial<RightsInput> = {}): RightsInput => ({
  rightsType: "owned",
  peopleConsentConfirmed: true,
  ...over,
});

describe("the hash of what was on the screen", () => {
  it("is 64 lower-case hex characters, the shape the contract demands", async () => {
    // `pattern: "^[a-f0-9]{64}$"`. A capital letter is a 400 nobody expects.
    const hex = await sha256Hex(RIGHTS_STATEMENT);
    expect(hex).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is a known value, so an accidental edit to the wording is visible here", async () => {
    /*
      This assertion is meant to fail when somebody changes the statement.

      "Sending only a version number would mean that editing the wording
      without bumping the version silently turns every prior attestation into a
      claim about words nobody saw." A test that pinned nothing would let that
      happen quietly; this one makes the edit a decision — change the text,
      this fails, and whoever changes it has to bump STATEMENT_VERSION and
      paste the new hash, which is exactly the moment to think about it.
    */
    expect(await sha256Hex(RIGHTS_STATEMENT)).toBe(
      "3a6a40fab663f3d28066b1d7da04ee0fbec207eeec8106ba3435d51f84d7322a",
    );
  });

  it("changes when a single character does", async () => {
    const a = await sha256Hex(RIGHTS_STATEMENT);
    const b = await sha256Hex(RIGHTS_STATEMENT.replace("ours", "our"));
    expect(a).not.toBe(b);
  });

  it("starts at version 1 and is an integer, as the contract requires", () => {
    expect(Number.isInteger(STATEMENT_VERSION)).toBe(true);
    expect(STATEMENT_VERSION).toBeGreaterThanOrEqual(1);
  });
});

describe("where the footage came from", () => {
  it("offers exactly the contract's three, and nothing else", () => {
    expect(RIGHTS_TYPES.map((r) => r.code)).toEqual([
      "owned",
      "licensed",
      "operator_granted",
    ]);
    expect(isRightsType("owned")).toBe(true);
    expect(isRightsType("borrowed")).toBe(false);
    expect(isRightsType("")).toBe(false);
  });

  it("asks which licence, when they say they paid for it", () => {
    const p = rightsProblem(input({ rightsType: "licensed" }));
    expect(p?.field).toBe("licenceRef");
    expect(
      rightsProblem(input({ rightsType: "licensed", licenceRef: "INV-88" })),
    ).toBeNull();
  });

  it("asks who gave permission, when somebody else filmed it", () => {
    const p = rightsProblem(input({ rightsType: "operator_granted" }));
    expect(p?.field).toBe("thirdPartyRef");
    expect(
      rightsProblem(
        input({ rightsType: "operator_granted", thirdPartyRef: "Asha M" }),
      ),
    ).toBeNull();
  });
});

describe("consent of the people filmed", () => {
  it("refuses an unanswered question rather than sending a quiet no", () => {
    /*
      "`peopleConsentConfirmed` must be an explicit `true` or `false`, never
      defaulted and never omitted: consent of the people filmed is the one
      thing a moderator cannot check by watching."

      A checkbox defaults to unticked, which is an answer nobody gave. So the
      unanswered state is `null` and it is refused here — never coerced.
    */
    const p = rightsProblem(input({ peopleConsentConfirmed: null }));
    expect(p?.field).toBe("peopleConsentConfirmed");
    expect(p?.message).toContain("no default");
  });

  it("accepts an explicit no, because no is an answer", () => {
    // A clip with nobody recognisable in it is a legitimate `false`, and
    // refusing it would push people to tick "yes" to get past the form.
    expect(rightsProblem(input({ peopleConsentConfirmed: false }))).toBeNull();
  });
});

describe("the optional facts", () => {
  it("takes a date it can send, and refuses one it cannot", () => {
    expect(rightsProblem(input({ filmedOn: "2026-08-14" }))).toBeNull();
    expect(rightsProblem(input({ filmedOn: "14/08/2026" }))?.field).toBe(
      "filmedOn",
    );
  });
});

describe("why a clip comes down", () => {
  it("offers exactly the contract's four, and nothing else", () => {
    expect(WITHDRAW_REASONS.map((r) => r.code)).toEqual([
      "operator_request",
      "people_in_it_objected",
      "no_longer_accurate",
      "rights_lapsed",
    ]);
    expect(isWithdrawReason("operator_request")).toBe(true);
    expect(isWithdrawReason("mistake")).toBe(false);
    expect(isWithdrawReason("")).toBe(false);
  });

  it("names what happened rather than offering a quick way out", () => {
    /*
      "The reason is a closed set because the counts matter —
      `people_in_it_objected` arriving repeatedly for one operator is a consent
      problem in how they film, not a series of unrelated takedowns."

      An operator who reaches for "we just want it down" because it is the
      easiest option is the operator whose filming nobody ever corrects, so the
      consent reason describes the event in the words it happened in.
    */
    const consent = WITHDRAW_REASONS.find(
      (r) => r.code === "people_in_it_objected",
    )!;
    expect(consent.label).toMatch(/objected/i);
    expect(consent.detail).toMatch(/asked not to be shown/i);
  });
});
