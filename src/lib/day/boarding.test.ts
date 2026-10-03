import { describe, expect, it } from "vitest";
import {
  boardable,
  boardingFlags,
  boardingOrder,
  cashToTake,
  headcount,
  matchesParty,
  type BoardingParty,
} from "./boarding";

const party = (over: Partial<BoardingParty>): BoardingParty => ({
  bookingId: "b1",
  name: "Asha Menon",
  reference: "YV-4K2M9P7Q",
  guests: 2,
  arrived: false,
  state: "confirmed",
  cash: null,
  signal: null,
  unread: 0,
  ...over,
});

const PARTIES = [
  party({ bookingId: "s", name: "Sofia Alves", guests: 1 }),
  party({ bookingId: "a", name: "asha menon", guests: 2, arrived: true }),
  party({ bookingId: "d", name: "Daniel Okafor", guests: 3 }),
];

/*
  Operator experiment D: built for the jetty at 06:00, one hand, bright sun.
*/
describe("who is still to come", () => {
  it("lists those to come first and those aboard after, each by name", () => {
    const { toCome, aboard } = boardingOrder(PARTIES, new Set());
    expect(toCome.map((p) => p.bookingId)).toEqual(["d", "s"]);
    expect(aboard.map((p) => p.bookingId)).toEqual(["a"]);
  });

  it("moves a check-in taken on this phone aboard before it is sent", () => {
    const { toCome, aboard } = boardingOrder(PARTIES, new Set(["s"]));
    expect(toCome.map((p) => p.bookingId)).toEqual(["d"]);
    expect(aboard.map((p) => p.bookingId)).toEqual(["a", "s"]);
  });

  it("counts guests, not parties, for the number read at arm's length", () => {
    expect(headcount(PARTIES, new Set())).toEqual({ aboard: 2, booked: 6 });
    expect(headcount(PARTIES, new Set(["d"]))).toEqual({
      aboard: 5,
      booked: 6,
    });
  });

  it("checks in only a booking that is still on", () => {
    expect(boardable({ state: "confirmed" })).toBe(true);
    expect(boardable({ state: "paid_pending_ops" })).toBe(true);
    expect(boardable({ state: "cancelled" })).toBe(false);
    expect(boardable({ state: "completed" })).toBe(false);
  });
});

describe("finding somebody at the jetty", () => {
  const asha = party({});

  it("finds a party by a word of the name from its start", () => {
    expect(matchesParty(asha, "asha")).toBe(true);
    expect(matchesParty(asha, "MEN")).toBe(true);
    expect(matchesParty(asha, "non")).toBe(false);
  });

  it("finds a party by the reference as it is read out, the last four alone too", () => {
    expect(matchesParty(asha, "9P7Q")).toBe(true);
    expect(matchesParty(asha, "yv-4k2m")).toBe(true);
    expect(matchesParty(asha, "YV 4K2M 9P7Q")).toBe(true);
    // One character is not a search; it is a first letter.
    expect(matchesParty(asha, "q")).toBe(false);
  });

  it("finds everybody when nothing is typed", () => {
    expect(matchesParty(asha, "  ")).toBe(true);
  });
});

describe("what a row says", () => {
  it("says the cash, the medical instruction and who wrote, in words", () => {
    expect(
      boardingFlags(
        party({
          cash: { collectPaise: 900_000, collected: false },
          signal: "flagged",
          unread: 2,
        }),
      ),
    ).toEqual(["Cash ₹9,000", "Medical: talk first", "2 messages"]);
    expect(boardingFlags(party({ signal: "outstanding", unread: 1 }))).toEqual([
      "No medical answer",
      "1 message",
    ]);
    expect(
      boardingFlags(
        party({ cash: { collectPaise: 900_000, collected: true } }),
      ),
    ).toEqual([]);
  });

  it("sums the cash still to take, and says unknown rather than understating it", () => {
    expect(
      cashToTake([
        party({ cash: { collectPaise: 450_000, collected: false } }),
        party({ cash: { collectPaise: 900_000, collected: true } }),
        party({ cash: null }),
      ]),
    ).toBe(450_000);
    expect(
      cashToTake([party({ cash: { collectPaise: null, collected: false } })]),
    ).toBeNull();
  });
});
