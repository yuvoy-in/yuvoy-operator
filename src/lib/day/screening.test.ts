import { describe, expect, it } from "vitest";
import {
  departureAsksScreening,
  isScreeningOutstanding,
  needsAttention,
  screeningSummary,
} from "./screening";
import type { Party } from "./types";

type Screening = NonNullable<Party["screening"]>;

function party(name: string, screening?: Partial<Screening>): Party {
  return {
    bookingId: `b-${name}`,
    reference: name.toUpperCase(),
    name,
    guests: 2,
    state: "confirmed",
    ...(screening
      ? {
          screening: {
            declared: false,
            clear: false,
            needsAttention: false,
            ...screening,
          },
        }
      : {}),
  };
}

describe("departureAsksScreening", () => {
  it("is false when no party carries the field", () => {
    // A snorkel trip. The screen must render nothing at all — not a
    // reassurance, and above all not "not screened" against eight people
    // nobody was ever going to ask.
    expect(departureAsksScreening([party("Ana"), party("Bo")])).toBe(false);
  });

  it("is true when one party carries it", () => {
    // The screener belongs to the listing, so if it applied to anybody it
    // applied to the departure. One is enough.
    expect(
      departureAsksScreening([party("Ana", { declared: true }), party("Bo")]),
    ).toBe(true);
  });

  it("is false for an empty manifest", () => {
    expect(departureAsksScreening([])).toBe(false);
  });
});

describe("isScreeningOutstanding", () => {
  it("is false for a party who answered", () => {
    expect(isScreeningOutstanding(party("Ana", { declared: true }))).toBe(
      false,
    );
  });

  it("is true for a party who was asked and has not answered", () => {
    expect(isScreeningOutstanding(party("Ana", { declared: false }))).toBe(
      true,
    );
  });

  it("is true for a party carrying no screening on a departure that asks", () => {
    /*
      The ambiguous case, resolved in the loud direction on purpose. Flagging
      somebody who did answer costs ten seconds of asking again; not flagging
      somebody who never answered is the failure the whole feature exists to
      prevent.
    */
    expect(isScreeningOutstanding(party("Bo"))).toBe(true);
  });

  it("does not read `clear` — an answered party is settled whatever they said", () => {
    /*
      A booking is refused outright on a declared condition, so `clear: false`
      on a manifest should not arise. If it ever does, this must NOT turn into
      a sentence about somebody's health on a list read aloud on a jetty.
      `needsAttention` is the only thing that may raise a row.
    */
    expect(
      isScreeningOutstanding(party("Ana", { declared: true, clear: false })),
    ).toBe(false);
  });
});

describe("needsAttention", () => {
  it("passes the server's flag through", () => {
    expect(needsAttention(party("Ana", { needsAttention: true }))).toBe(true);
  });

  it("is never derived from declared and clear", () => {
    /*
      The contract computes it server-side "so a phone, a printout and the
      admin console cannot disagree about who to stop". A party who has not
      answered is outstanding; whether they are also flagged is the server's
      call, and this asserts the client does not invent one.
    */
    const notAnswered = party("Bo", { declared: false, clear: false });
    expect(needsAttention(notAnswered)).toBe(false);
    expect(isScreeningOutstanding(notAnswered)).toBe(true);
  });

  it("is false when the departure asks nothing", () => {
    expect(needsAttention(party("Ana"))).toBe(false);
  });
});

describe("screeningSummary", () => {
  it("says nothing on a departure that never asks", () => {
    const s = screeningSummary([party("Ana"), party("Bo")]);
    expect(s.asks).toBe(false);
    expect(s.outstanding).toBe(0);
    expect(s.flagged).toBe(0);
  });

  it("counts the ones with no answer on record", () => {
    const s = screeningSummary([
      party("Ana", { declared: true }),
      party("Bo", { declared: false }),
      party("Cy"),
      party("Di", { declared: true }),
    ]);
    expect(s).toEqual({ asks: true, outstanding: 2, total: 4, flagged: 0 });
  });

  it("distinguishes 'asks, nobody outstanding' from 'never asks'", () => {
    /*
      The reason a summary exists at all. Both of these render a list of
      unmarked rows, and a row-level flag alone cannot tell them apart.
    */
    const answered = screeningSummary([
      party("Ana", { declared: true }),
      party("Bo", { declared: true }),
    ]);
    const neverAsked = screeningSummary([party("Ana"), party("Bo")]);

    expect(answered.asks).toBe(true);
    expect(answered.outstanding).toBe(0);
    expect(neverAsked.asks).toBe(false);
    expect(answered).not.toEqual(neverAsked);
  });

  it("counts the server's flags separately from the unanswered", () => {
    // The case the contract names as the interesting one: flagged AND never
    // answered. It is one party, and it belongs in both counts.
    const s = screeningSummary([
      party("Ana", { declared: false, needsAttention: true }),
      party("Bo", { declared: true }),
    ]);
    expect(s.outstanding).toBe(1);
    expect(s.flagged).toBe(1);
    expect(s.total).toBe(2);
  });

  it("counts every row on the manifest, holds included", () => {
    /*
      The denominator must match the list on screen so the sentence is
      checkable by the person reading it. Holds are on the manifest because
      "a party mid-checkout at 08:40 may walk up at 08:55" — and one who walks
      up having never answered is exactly the case this exists for.
    */
    const hold: Party = {
      reference: "HOLD",
      name: "Eve",
      guests: 1,
      state: "holding",
    };
    const s = screeningSummary([party("Ana", { declared: true }), hold]);
    expect(s.total).toBe(2);
    expect(s.outstanding).toBe(1);
  });
});
