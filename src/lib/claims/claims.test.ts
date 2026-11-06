import { describe, expect, it } from "vitest";
import { OperatorApiError, OperatorNetworkError } from "@/lib/api/errors";
import { StalledError } from "@/lib/api/deadline";
import {
  canClaimListing,
  claimFailure,
  claimOutcome,
  claimPath,
  claimRoleLine,
  claimRows,
  claimStateLine,
  claimUnsent,
  emailFieldLabel,
  isClaimPath,
  type ClaimLike,
} from "./claims";
import { REMOVED_LISTING } from "./words";

/* The claim's rules (yuvoy-operator#388), read against the phone's words. */

const claim = (over: Partial<ClaimLike> = {}): ClaimLike => ({
  claimId: "c1",
  subjectName: "Example Reef Divers",
  state: "waiting",
  decisionCode: null,
  proofMethod: "documents",
  proofCode: null,
  proofEmailVerifiedAt: null,
  websiteHost: "claimtest.yuvoy.in",
  createdAt: "2026-10-21T09:00:00Z",
  ...over,
});

const refusal = (
  status: number,
  code: string,
  message: string,
  details?: unknown,
) => new OperatorApiError({ status, code, message, details });

describe("who may claim", () => {
  it("is an owner or an admin", () => {
    expect(canClaimListing(["OWNER"])).toBe(true);
    expect(canClaimListing(["ADMIN"])).toBe(true);
    expect(canClaimListing(["MANAGER"])).toBe(false);
    expect(canClaimListing(["STAFF"])).toBe(false);
    expect(canClaimListing([])).toBe(false);
  });

  it("tells the others who can, by the business's name", () => {
    expect(claimRoleLine("Reef Divers Havelock")).toBe(
      "Only an owner or admin of Reef Divers Havelock can claim a listing. Send them this link.",
    );
    expect(claimRoleLine("  ")).toBe(
      "Only an owner or admin of your business can claim a listing. Send them this link.",
    );
    expect(claimRoleLine(null)).toContain("your business");
  });
});

describe("the email field", () => {
  it("names the listing's website", () => {
    expect(emailFieldLabel("claimtest.yuvoy.in")).toBe(
      "Your address at claimtest.yuvoy.in",
    );
    expect(emailFieldLabel(null)).toBe("Your address at the listing's website");
  });
});

describe("where a claim stands", () => {
  it("says each state in the business's words", () => {
    expect(claimStateLine(claim())).toBe("Waiting for us to check");
    expect(claimStateLine(claim({ state: "approved" }))).toBe("Approved");
    expect(
      claimStateLine(
        claim({ state: "refused", decisionCode: "PROOF_NOT_CONFIRMED" }),
      ),
    ).toBe(
      "Not approved: we could not confirm your proof. You can claim again another way.",
    );
    expect(
      claimStateLine(claim({ state: "refused", decisionCode: "DUPLICATE" })),
    ).toBe(
      "Not approved: this listing is already covered by another claim or account.",
    );
    expect(
      claimStateLine(
        claim({
          state: "refused",
          // A code this app does not know yet, as a newer API could send.
          decisionCode: "SOMETHING_NEW" as unknown as ClaimLike["decisionCode"],
        }),
      ),
    ).toBe("Not approved");
    expect(claimStateLine(claim({ state: "withdrawn" }))).toBe(
      "Closed: this listing was removed while we were checking. Nothing more to do.",
    );
  });
});

describe("after Ask to claim", () => {
  it("gives the code to post, the email steps, or what we do next", () => {
    expect(
      claimOutcome(
        claim({ proofMethod: "public_page_code", proofCode: "YUVOY-7KQ4MX" }),
      ),
    ).toEqual({
      kind: "code",
      heading: "Post this code on your page",
      code: "YUVOY-7KQ4MX",
      body: "Put YUVOY-7KQ4MX on your website or your business's social media page, exactly as it is, and leave it there until we decide. You can find it again under Verification.",
    });
    expect(claimOutcome(claim({ proofMethod: "email_domain" }))).toEqual({
      kind: "email",
    });
    expect(
      claimOutcome(claim({ proofMethod: "call_to_published_number" })),
    ).toEqual({
      kind: "wait",
      body: "We will call the number on your public page. Nothing more to do here.",
    });
    expect(claimOutcome(claim({ proofMethod: "documents" }))).toEqual({
      kind: "wait",
      body: "We will get in touch to ask for your papers. Nothing more to do here.",
    });
  });
});

describe("the claims list", () => {
  it("is newest first, ties kept as sent", () => {
    const rows = claimRows(
      [
        claim({ claimId: "old", createdAt: "2026-10-01T00:00:00Z" }),
        claim({ claimId: "a", createdAt: "2026-10-05T00:00:00Z" }),
        claim({ claimId: "b", createdAt: "2026-10-05T00:00:00Z" }),
      ],
      true,
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "old"]);
  });

  it("shows a waiting code again, and only while it waits", () => {
    const code: Partial<ClaimLike> = {
      proofMethod: "public_page_code",
      proofCode: "YUVOY-7KQ4MX",
    };
    expect(claimRows([claim(code)], true)[0].code).toBe("YUVOY-7KQ4MX");
    expect(
      claimRows([claim({ ...code, state: "approved" })], true)[0].code,
    ).toBeNull();
  });

  it("offers the email steps to an owner while the code is still needed", () => {
    const email = claim({ proofMethod: "email_domain" });
    expect(claimRows([email], true)[0]).toMatchObject({
      offerEmail: true,
      emailChecked: false,
    });
    expect(claimRows([email], false)[0].offerEmail).toBe(false);
    const checked = claim({
      proofMethod: "email_domain",
      proofEmailVerifiedAt: "2026-10-21T09:10:00Z",
    });
    expect(claimRows([checked], true)[0]).toMatchObject({
      offerEmail: false,
      emailChecked: true,
    });
  });

  it("names a removed listing", () => {
    expect(claimRows([claim({ subjectName: " " })], true)[0].name).toBe(
      REMOVED_LISTING,
    );
  });
});

describe("a claim link's path", () => {
  it("is /claim/{slug}", () => {
    expect(claimPath("example-reef-divers")).toBe("/claim/example-reef-divers");
    expect(isClaimPath("/claim/example-reef-divers")).toBe(true);
    expect(isClaimPath("/claim/example-reef-divers?x=1")).toBe(true);
    expect(isClaimPath("/claim")).toBe(false);
    expect(isClaimPath("/claim/a/b")).toBe(false);
    expect(isClaimPath(null)).toBe(false);
  });
});

describe("a refused claim", () => {
  it("is the API's sentence", () => {
    expect(
      claimFailure(
        refusal(
          409,
          "claim_already_open",
          "A claim on this listing is already with our team.",
        ),
        "create",
      ),
    ).toEqual({
      message: "A claim on this listing is already with our team.",
      noWebsite: false,
      readAgain: false,
    });
    expect(
      claimFailure(
        refusal(403, "forbidden", "your role does not allow this"),
        "create",
      ).message,
    ).toBe("Your role does not allow this.");
  });

  it("greys the email proof on no_website", () => {
    const f = claimFailure(
      refusal(
        400,
        "invalid_input",
        "This listing has no website, so prove it another way.",
        { proofMethod: "no_website" },
      ),
      "create",
    );
    expect(f.noWebsite).toBe(true);
    expect(f.message).toBe(
      "This listing has no website, so prove it another way.",
    );
  });

  it("reads the list again when the claim was decided meanwhile", () => {
    expect(
      claimFailure(
        refusal(409, "conflict", "This claim is decided already.", {
          reason: "not_waiting",
        }),
        "check",
      ).readAgain,
    ).toBe(true);
    expect(
      claimFailure(
        refusal(
          409,
          "proof_method_not_email",
          "This claim is not proven by email.",
        ),
        "check",
      ).readAgain,
    ).toBe(false);
  });

  it("puts a suspension before the role sentence", () => {
    expect(
      claimFailure(
        refusal(403, "account_suspended", "this business is suspended"),
        "create",
      ).message,
    ).toBe("This business is suspended.");
  });

  it("never says nothing was sent when the write went quiet", () => {
    const quiet = new OperatorNetworkError(new StalledError(15000));
    expect(claimFailure(quiet, "create").message).toBe(
      "The connection dropped, so we cannot tell whether that went through. Look under Verification to see whether your claim is there.",
    );
    expect(claimFailure(quiet, "send").message).toContain(
      "If no code comes, send another.",
    );
  });

  it("says no signal when the request never left", () => {
    expect(claimFailure(new OperatorNetworkError(), "check")).toEqual(
      claimUnsent("check"),
    );
    expect(claimUnsent("create").message).toBe(
      "No signal. Nothing was sent: ask again when you have one.",
    );
  });

  it("falls back when the API sent no sentence", () => {
    expect(
      claimFailure(refusal(500, "internal_error", ""), "send").message,
    ).toBe("That did not work. Try again.");
    expect(claimFailure(new Error("boom"), "send").message).toBe(
      "That did not work. Try again.",
    );
  });
});
