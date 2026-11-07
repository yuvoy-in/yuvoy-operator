import { describe, it, expect } from "vitest";
import {
  credentialName,
  credentialText,
  documentAction,
  expirySentence,
  expirySentences,
  expiryWarning,
  replaceAction,
  stateLabel,
  verifiedWithoutFile,
  type OperatorCredential,
} from "./standing";

/** 5 September 2026, 09:00 IST. */
const NOW = Date.parse("2026-09-05T09:00:00+05:30");

const credential = (
  over: Partial<OperatorCredential> = {},
): OperatorCredential => ({
  /*
    `id` and `hasFile` became required on `OperatorCredential` in the 13 Sep
    contract: an id is what an upload names on
    `POST /credentials/{id}/upload-intents`, and `hasFile` is sent on every row
    "so a screen offers an upload or shows the file without inferring either
    from a field being absent".

    Set here so the fixture is a shape the API can actually send. `hasFile`
    is read by `credentialText` since yuvoy-operator#93 (a verified document
    we hold no file for is not simply "Verified"), so a test about a plain
    verified row says `hasFile: true` rather than leaning on this default.
  */
  id: "cred_insurance",
  hasFile: false,
  type: "insurance",
  state: "verified",
  mandatory: true,
  ...over,
});

describe("a database constant is not a phone screen", () => {
  it("makes a screaming-snake value readable without interpreting it", () => {
    expect(stateLabel("PROSPECT")).toBe("Prospect");
    expect(stateLabel("AWAITING_REVIEW")).toBe("Awaiting review");
    expect(stateLabel("")).toBe("");
  });

  it("names a credential from its type", () => {
    expect(
      credentialName(credential({ type: "directorate_registration" })),
    ).toBe("Directorate registration");
    expect(credentialName(credential({ type: undefined }))).toBe("Document");
  });
});

describe("what expires, and when", () => {
  it("warns inside sixty days and says nothing before", () => {
    /*
      "'What expires' is the load-bearing half. A dive licence that lapses
      mid-season takes the listing down, and an operator who was never shown
      the date finds out from a cancelled booking." Sixty days is a season's
      notice on an island where paperwork travels by ferry.
    */
    expect(expiryWarning(credential({ expiresOn: "2026-10-05" }), NOW)).toBe(
      "Expires in 30 days",
    );
    expect(expiryWarning(credential({ expiresOn: "2026-09-06" }), NOW)).toBe(
      "Expires tomorrow",
    );
    expect(expiryWarning(credential({ expiresOn: "2026-09-05" }), NOW)).toBe(
      "Expires today",
    );
    expect(expiryWarning(credential({ expiresOn: "2026-09-04" }), NOW)).toBe(
      "Expired",
    );
    expect(
      expiryWarning(credential({ expiresOn: "2027-06-01" }), NOW),
    ).toBeNull();
    expect(expiryWarning(credential({ expiresOn: undefined }), NOW)).toBeNull();
  });

  it("counts the days in the market's calendar, not the runner's", () => {
    /*
      `expiresOn` is a DATE because "a licence expires on a day, and sending a
      timestamp invites a timezone bug on the one field an operator plans a
      season around". 03:00 IST on the 5th is 21:30 UTC on the 4th — counted in
      UTC, a licence expiring on the 5th would read as already expired to the
      operator standing in it.
    */
    const earlyMorningIST = Date.parse("2026-09-05T03:00:00+05:30");
    expect(
      expiryWarning(credential({ expiresOn: "2026-09-05" }), earlyMorningIST),
    ).toBe("Expires today");
  });

  it("does not warn about a date it cannot parse", () => {
    expect(
      expiryWarning(credential({ expiresOn: "05/09/2026" }), NOW),
    ).toBeNull();
  });
});

describe("what a credential row says", () => {
  it("branches on the closed `state` enum", () => {
    expect(
      credentialText(credential({ state: "verified", hasFile: true }), NOW),
    ).toEqual({
      tone: "ok",
      text: "Verified",
    });
    expect(credentialText(credential({ state: "pending" }), NOW).tone).toBe(
      "warn",
    );
    expect(credentialText(credential({ state: "rejected" }), NOW).tone).toBe(
      "problem",
    );
    expect(credentialText(credential({ state: "expired" }), NOW).tone).toBe(
      "problem",
    );
  });

  it("lets an approaching expiry override 'Verified'", () => {
    // Verified and lapsing next week is not a green tick. It is the one row
    // an operator has to act on before anybody tells them to.
    const row = credentialText(
      credential({ state: "verified", expiresOn: "2026-09-12" }),
      NOW,
    );
    expect(row.tone).toBe("warn");
    expect(row.text).toBe("Expires in 7 days");
  });

  it("never says simply 'Verified' over a document we hold no file for", () => {
    /*
      yuvoy-operator#93: the review read "Verified" and "No file sent" on one
      row, with no way to act on either. Yuvoy had vouched for a document it
      could not produce.
    */
    const row = credentialText(
      credential({ state: "verified", hasFile: false }),
      NOW,
    );
    expect(row).toEqual({
      tone: "warn",
      text: "Verified, but we hold no file for it",
      saysNoFile: true,
    });
    expect(verifiedWithoutFile({ state: "verified", hasFile: false })).toBe(
      true,
    );
  });

  it("still leads with an approaching expiry when there is no file", () => {
    // The date is the one that takes a listing down; the file line under it
    // says the rest, so the status does not claim to have said it.
    const row = credentialText(
      credential({
        state: "verified",
        hasFile: false,
        expiresOn: "2026-09-12",
      }),
      NOW,
    );
    expect(row).toEqual({ tone: "warn", text: "Expires in 7 days" });
  });

  it("leaves the row as it was when an older API sends no flag", () => {
    // Absent is not false. A row that never said is not accused of anything.
    const withoutFlag = {
      ...credential({ state: "verified" }),
    } as Partial<OperatorCredential>;
    delete withoutFlag.hasFile;
    const row = credentialText(withoutFlag as OperatorCredential, NOW);
    expect(row).toEqual({ tone: "ok", text: "Verified" });
    expect(verifiedWithoutFile(withoutFlag)).toBe(false);
  });

  it("is only about verified documents: pending with no file is just waiting", () => {
    expect(verifiedWithoutFile({ state: "pending", hasFile: false })).toBe(
      false,
    );
    expect(verifiedWithoutFile({ state: "verified", hasFile: true })).toBe(
      false,
    );
  });

  it("says something for a state it does not know", () => {
    const row = credentialText(
      credential({
        state: "under_appeal" as OperatorCredential["state"],
      }),
      NOW,
    );
    expect(row.text).toBe("Under appeal");
    expect(row.tone).toBe("warn");
  });
});

describe("an expiry, said as the loss of sales it is — yuvoy-operator#46", () => {
  it("renders the issue's sentence for a verified document inside sixty days", () => {
    expect(expirySentence(credential({ expiresOn: "2026-10-05" }), NOW)).toBe(
      "Insurance expires 5 October 2026. Listings that need it come down that day.",
    );
  });

  it("says nothing before the window, after the date, or for a document that is not keeping listings up", () => {
    expect(
      expirySentence(credential({ expiresOn: "2027-06-01" }), NOW),
    ).toBeNull();
    // Already expired: the row says so, and louder.
    expect(
      expirySentence(credential({ expiresOn: "2026-09-04" }), NOW),
    ).toBeNull();
    expect(
      expirySentence(
        credential({ state: "pending", expiresOn: "2026-10-05" }),
        NOW,
      ),
    ).toBeNull();
    expect(
      expirySentence(credential({ expiresOn: undefined }), NOW),
    ).toBeNull();
  });
});

describe("a Replace the API will accept — yuvoy-operator#46", () => {
  it("offers none for a document that is current and months from expiry", () => {
    // `POST /credentials` refuses a new copy until the renewal window opens.
    expect(
      replaceAction(credential({ expiresOn: "2027-06-01" }), NOW),
    ).toBeNull();
    expect(replaceAction(credential({ expiresOn: undefined }), NOW)).toBeNull();
  });

  it("opens exactly when the API's renewal window does", () => {
    // Sixty days from 5 September 2026 is 4 November.
    expect(replaceAction(credential({ expiresOn: "2026-11-04" }), NOW)).toEqual(
      { href: "/profile#documents", label: "Replace it" },
    );
    expect(
      replaceAction(credential({ expiresOn: "2026-11-05" }), NOW),
    ).toBeNull();
  });

  it("asks for a new one when the last was turned down or has run out", () => {
    expect(replaceAction(credential({ state: "rejected" }), NOW)?.label).toBe(
      "Send a new one",
    );
    expect(replaceAction(credential({ state: "expired" }), NOW)?.label).toBe(
      "Send a new one",
    );
  });
});

describe("a document is its whole history, not one row — yuvoy-operator#46", () => {
  it("says nothing about a certificate that has already been renewed", () => {
    // The list carries last year's copy beside this year's.
    const renewed = [
      credential({ expiresOn: "2026-09-20" }),
      credential({ expiresOn: "2027-09-20" }),
    ];
    expect(expirySentences(renewed, NOW)).toEqual([]);
    expect(documentAction(renewed, NOW)).toBeNull();
  });

  it("warns, and offers the renewal, when the best copy is the one running out", () => {
    const rows = [credential({ expiresOn: "2026-10-05" })];
    expect(expirySentences(rows, NOW)).toEqual([
      "Insurance expires 5 October 2026. Listings that need it come down that day.",
    ]);
    expect(documentAction(rows, NOW)?.label).toBe("Replace it");
  });

  it("keeps warning while a renewal waits with us — the date is still the date", () => {
    const rows = [
      credential({ expiresOn: "2026-10-05" }),
      credential({ state: "pending", expiresOn: undefined }),
    ];
    expect(expirySentences(rows, NOW)).toHaveLength(1);
    expect(documentAction(rows, NOW)?.label).toBe("Replace it");
  });

  it("offers nothing under an old refusal once a current copy is held", () => {
    const rows = [
      credential({ state: "rejected" }),
      credential({ expiresOn: "2027-06-01" }),
    ];
    expect(documentAction(rows, NOW)).toBeNull();
  });

  it("asks for a new one when every copy was refused or has run out", () => {
    expect(
      documentAction([credential({ state: "rejected" })], NOW)?.label,
    ).toBe("Send a new one");
    // Verified, and its date has passed before its state caught up.
    expect(
      documentAction([credential({ expiresOn: "2026-09-01" })], NOW)?.label,
    ).toBe("Send a new one");
  });

  it("counts a document that never expires as the best copy there is", () => {
    const rows = [
      credential({ expiresOn: "2026-10-05" }),
      credential({ expiresOn: undefined }),
    ];
    expect(expirySentences(rows, NOW)).toEqual([]);
    expect(documentAction(rows, NOW)).toBeNull();
  });
});
