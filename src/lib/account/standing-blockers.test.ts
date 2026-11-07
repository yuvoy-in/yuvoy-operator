import { describe, it, expect } from "vitest";
import {
  blockerText,
  byGatingFirst,
  gatesSale,
  headline,
  splitByWaitingOn,
  standingOf,
  type AccountStanding,
  type Blocker,
} from "./standing";

const blocker = (over: Partial<Blocker> = {}): Blocker => ({
  code: "CREDENTIAL_MISSING",
  label: "We still need your insurance certificate",
  waitingOn: "operator",
  // Required since yuvoy-api#139. A missing credential does stop a sale.
  gates: true,
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

  it("survives a response with no blocking, credentials or requirements", () => {
    const s = standingOf({ bookable: true } as unknown as AccountStanding);
    expect(s).toEqual({
      state: "",
      bookable: true,
      blocking: [],
      credentials: [],
      requiredDocuments: [],
    });
  });

  it("keeps a required document type it has never heard of", () => {
    /*
      The enum is the eight this build knows, and a ninth added on the other
      side must still be counted: the line reads "5 of 6", and a row quietly
      dropped makes it "5 of 5" and tells an operator they are finished
      (yuvoy-operator#46 item 1).
    */
    const s = standingOf({
      bookable: true,
      requiredDocuments: [
        { type: "insurance", satisfied: true },
        { type: "drone_permit", satisfied: false },
      ],
    } as unknown as AccountStanding);
    expect(s?.requiredDocuments).toEqual([
      { type: "insurance", satisfied: true },
      { type: "drone_permit", satisfied: false },
    ]);
  });

  it("drops a requirement that is missing either half of the answer", () => {
    // A type with no verdict cannot be counted either way, and guessing `false`
    // would put a document an operator has already sent into "waiting on you".
    const s = standingOf({
      bookable: true,
      requiredDocuments: [{ type: "insurance" }, { satisfied: true }],
    } as unknown as AccountStanding);
    expect(s?.requiredDocuments).toEqual([]);
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
