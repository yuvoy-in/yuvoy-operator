import { describe, it, expect } from "vitest";
import {
  blockerText,
  byGatingFirst,
  gatesSale,
  credentialName,
  credentialText,
  documentAction,
  expirySentence,
  expirySentences,
  expiryWarning,
  headline,
  replaceAction,
  splitByWaitingOn,
  standingOf,
  stateLabel,
  type AccountStanding,
  type Blocker,
  type OperatorCredential,
} from "./standing";

/** 5 September 2026, 09:00 IST. */
const NOW = Date.parse("2026-09-05T09:00:00+05:30");

const blocker = (over: Partial<Blocker> = {}): Blocker => ({
  code: "CREDENTIAL_MISSING",
  label: "We still need your insurance certificate",
  waitingOn: "operator",
  // Required since yuvoy-api#139. A missing credential does stop a sale.
  gates: true,
  ...over,
});

const credential = (
  over: Partial<OperatorCredential> = {},
): OperatorCredential => ({
  /*
    `id` and `hasFile` became required on `OperatorCredential` in the 13 Sep
    contract: an id is what an upload names on
    `POST /credentials/{id}/upload-intents`, and `hasFile` is sent on every row
    "so a screen offers an upload or shows the file without inferring either
    from a field being absent".

    Set here so the fixture is a shape the API can actually send. Nothing in
    `standing.ts` reads either, which is why this was only a type error.
  */
  id: "cred_insurance",
  hasFile: false,
  type: "insurance",
  state: "verified",
  mandatory: true,
  ...over,
});

const standing = (over: Partial<AccountStanding> = {}): AccountStanding => ({
  state: "PROSPECT",
  bookable: false,
  blocking: [],
  ...over,
});

describe("absent is unknown, never fine", () => {
  it("returns null when the account block is missing", () => {
    /*
      The contract's own words: "Absent means unknown — never 'everything is
      fine'." An older API, a rollback or a partial response must not render as
      approval — the screen says it cannot tell instead.
    */
    expect(standingOf(undefined)).toBeNull();
  });

  it("returns null when `bookable` is not a boolean", () => {
    /*
      `bookable` is required. Defaulting a missing one to `false` would tell a
      live operator they cannot sell; defaulting to `true` is the lie this
      module exists to remove. Neither — it is unknown.
    */
    expect(
      standingOf({ state: "LIVE" } as unknown as AccountStanding),
    ).toBeNull();
    expect(
      standingOf({
        state: "LIVE",
        bookable: "yes",
      } as unknown as AccountStanding),
    ).toBeNull();
  });

  it("survives a response with no blocking or credentials arrays", () => {
    const s = standingOf({ bookable: true } as unknown as AccountStanding);
    expect(s).toEqual({
      state: "",
      bookable: true,
      blocking: [],
      credentials: [],
    });
  });
});

describe("what the screen says at the top", () => {
  it("says live only when `bookable` is true", () => {
    expect(headline(standingOf(standing({ bookable: true }))!).title).toBe(
      "Your account is live",
    );
  });

  it("does not say live for a PROSPECT, whatever its state reads", () => {
    /*
      The defect this whole change fixes. Before `AccountStanding`, /account
      said "your account is live" to anybody whose `GET /me` returned 200 — and
      after self-signup (D-029) a PROSPECT is the most common operator there
      is: real account, real session, cannot sell a thing.
    */
    const h = headline(standingOf(standing())!);
    expect(h.title).toBe("You cannot be booked yet");
    expect(h.title).not.toMatch(/live/i);
  });

  it("counts what is waiting on the operator, and only that", () => {
    const h = headline(
      standingOf(
        standing({
          blocking: [
            blocker(),
            blocker({ label: "And your registration" }),
            blocker({ waitingOn: "yuvoy", label: "We are checking it" }),
          ],
        }),
      )!,
    );
    expect(h.body).toContain("2 things are waiting on you");
  });

  it("never says 'nothing outstanding' to somebody who cannot sell", () => {
    /*
      An account that cannot trade with an empty blocking list is not "all
      done" — it is Yuvoy holding it. The API avoids this by sending
      AWAITING_REVIEW; this covers the case where it does not, because
      "nothing outstanding" beside "you cannot be booked" reads as our fault
      and produces the phone call O3 exists to prevent.
    */
    const h = headline(standingOf(standing({ blocking: [] }))!);
    expect(h.body).toMatch(/with us/i);
    expect(h.body).not.toMatch(/nothing (is )?outstanding/i);
  });
});

/*
  THE THIRD STATE, AND THE LIST THAT VANISHED — yuvoy-operator#38.

  `bookable` used to go false for ANY outstanding item, so "live" and "has
  something outstanding" could not both be true and two sentences covered
  every account. yuvoy-api#139 narrowed `bookable` to what actually stops a
  sale — an operator with three listings selling was being told "you cannot be
  booked yet" over a missing logo — and this portal, which gated the whole
  outstanding list on `!bookable`, stopped asking anybody for their logo or
  their registered address.
*/
describe("live, and still owing us something", () => {
  const owed = (over: Partial<Blocker> = {}) =>
    blocker({ gates: false, label: "We still need your logo", ...over });

  it("says BOTH halves: open for business, and still outstanding", () => {
    const h = headline(
      standingOf(
        standing({
          bookable: true,
          blocking: [owed(), owed({ label: "And your address" })],
        }),
      )!,
    );
    expect(h.title).toMatch(/live/i);
    expect(h.title).toContain("2 things are still outstanding");
    expect(h.body).toMatch(/can book your departures/i);
    expect(h.body).toMatch(/not blocking you/i);
  });

  it("counts one thing as one thing, in words", () => {
    const h = headline(
      standingOf(standing({ bookable: true, blocking: [owed()] }))!,
    );
    expect(h.title).toContain("one thing is still outstanding");
    expect(h.title).not.toMatch(/\b1 thing/);
  });

  it("still gets out of the way when nothing is outstanding", () => {
    const h = headline(standingOf(standing({ bookable: true, blocking: [] }))!);
    expect(h.title).toBe("Your account is live");
    expect(h.body).toBe("Travellers can book your departures.");
  });

  it("will not promise 'not blocking you' when a row says it gates", () => {
    /*
      `bookable: true` beside a `gates: true` row is a response contradicting
      itself. The reassuring half of that sentence is the one that must not be
      said on a guess, so the claim is made from the rows rather than from
      `bookable`.
    */
    const h = headline(
      standingOf(standing({ bookable: true, blocking: [owed(), blocker()] }))!,
    );
    expect(h.title).toMatch(/live/i);
    expect(h.body).not.toMatch(/not blocking you/i);
    expect(h.body).toMatch(/holding a listing back/i);
  });
});

describe("whether an outstanding item is costing anything", () => {
  it("reads `gates` when it is a boolean", () => {
    expect(gatesSale(blocker({ gates: true }))).toBe(true);
    expect(gatesSale(blocker({ gates: false }))).toBe(false);
  });

  it("refuses to guess when the row will not say", () => {
    /*
      `gates` is REQUIRED on the contract, and an older deployment or a
      partial row must still not be turned into a claim. "This is not stopping
      sales" is the sentence that makes an operator ignore something real, and
      "this is stopping sales" is the sentence that made them believe a
      selling business was shut. Unknown is a third answer.
    */
    const partial = { ...blocker(), gates: undefined } as unknown as Blocker;
    expect(gatesSale(partial)).toBeNull();
  });

  it("puts what is costing money first, then unknown, then the rest", () => {
    const gating = blocker({ gates: true, label: "gating" });
    const owed = blocker({ gates: false, label: "owed" });
    const unknown = { ...blocker({ label: "unknown" }), gates: undefined };
    const sorted = byGatingFirst([owed, unknown as unknown as Blocker, gating]);
    expect(sorted.map((b) => b.label)).toEqual(["gating", "unknown", "owed"]);
  });

  it("keeps the API's own order within a rank", () => {
    const first = blocker({ gates: false, label: "first" });
    const second = blocker({ gates: false, label: "second" });
    expect(byGatingFirst([first, second]).map((b) => b.label)).toEqual([
      "first",
      "second",
    ]);
  });

  it("does not mutate what it was given", () => {
    const rows = [blocker({ gates: false }), blocker({ gates: true })];
    const before = [...rows];
    byGatingFirst(rows);
    expect(rows).toEqual(before);
  });
});

describe("who has to move next", () => {
  it("splits on `waitingOn`", () => {
    const { operator, yuvoy } = splitByWaitingOn([
      blocker({ label: "yours" }),
      blocker({ label: "ours", waitingOn: "yuvoy" }),
    ]);
    expect(operator.map((b) => b.label)).toEqual(["yours"]);
    expect(yuvoy.map((b) => b.label)).toEqual(["ours"]);
  });

  it("puts an unrecognised `waitingOn` with Yuvoy, not with the operator", () => {
    /*
      Asymmetric on purpose. Telling an operator to act when nothing is theirs
      to do costs a phone call; the reverse leaves them waiting all season for
      a document only they could have sent.
    */
    const { operator, yuvoy } = splitByWaitingOn([
      blocker({ waitingOn: "someone_else" as Blocker["waitingOn"] }),
    ]);
    expect(operator).toHaveLength(0);
    expect(yuvoy).toHaveLength(1);
  });
});

describe("a blocker is always readable", () => {
  it("renders the label for a code it recognises", () => {
    expect(blockerText(blocker())).toBe(
      "We still need your insurance certificate",
    );
  });

  it("renders the label for a code it does not recognise, including OTHER", () => {
    /*
      The contract's condition for its own escape hatch: "`OTHER` exists so a
      reason can be added operationally without a contract change and without
      breaking a client: render `label` for anything you do not recognise."
      A client that switched on `code` and fell through to nothing would turn
      every new operational reason into an invisible blocker.
    */
    expect(
      blockerText(blocker({ code: "OTHER", label: "Your boat survey" })),
    ).toBe("Your boat survey");
    expect(
      blockerText(
        blocker({
          code: "SOMETHING_INVENTED_NEXT_YEAR" as Blocker["code"],
          label: "A reason from the future",
        }),
      ),
    ).toBe("A reason from the future");
  });

  it("never renders a blank row", () => {
    // A blank line reads as a bug rather than as something outstanding, so the
    // code is made readable and shown — something to quote on the phone.
    expect(blockerText(blocker({ label: "" }))).toBe("Credential missing");
    expect(
      blockerText({
        code: "",
        label: "",
        waitingOn: "operator",
      } as unknown as Blocker),
    ).toMatch(/we have not said what/i);
  });
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
    expect(credentialText(credential({ state: "verified" }), NOW)).toEqual({
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
