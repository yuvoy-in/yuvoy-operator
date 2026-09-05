import { describe, it, expect } from "vitest";
import {
  blockerText,
  credentialName,
  credentialText,
  expiryWarning,
  headline,
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
  ...over,
});

const credential = (
  over: Partial<OperatorCredential> = {},
): OperatorCredential => ({
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
