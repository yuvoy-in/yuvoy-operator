import { afterEach, describe, expect, it } from "vitest";
import {
  displayCode,
  holdCheckInLink,
  normaliseCode,
  readCheckInLink,
  takeHeldCheckInLink,
} from "./check-in-link";

/*
  The traveller's check-in link read as yuvoy-api's `checkin.ParseLink` and
  `invite.Normalise` read it (yuvoy-operator#175), and held through sign-in.
*/

const LINK = "https://operators.yuvoy.in/check-in#YV-7K2Q4BCD.K7QM2XPA";

describe("normaliseCode", () => {
  it("takes any case, spaces, tabs and hyphens", () => {
    expect(normaliseCode("k7qm-2xpa")).toBe("K7QM2XPA");
    expect(normaliseCode(" K7QM 2XPA\t")).toBe("K7QM2XPA");
  });

  it("refuses letters the alphabet leaves out, and the wrong length", () => {
    expect(normaliseCode("K7QM2XP0")).toBeNull();
    expect(normaliseCode("K7QM2XPI")).toBeNull();
    expect(normaliseCode("K7QM2XP")).toBeNull();
    expect(normaliseCode("K7QM2XPAB")).toBeNull();
  });

  it("refuses anything that is not ASCII before upper-casing it", () => {
    // "ß" upper-cases to "SS" here and stays itself in Go.
    expect(normaliseCode("K7QM2Xß")).toBeNull();
  });
});

describe("displayCode", () => {
  it("writes the code in two fours", () => {
    expect(displayCode("K7QM2XPA")).toBe("K7QM-2XPA");
  });
});

describe("readCheckInLink", () => {
  it("reads the whole link, the hash and the fragment alike", () => {
    const want = { reference: "YV-7K2Q4BCD", code: "K7QM2XPA" };
    expect(readCheckInLink(LINK)).toEqual(want);
    expect(readCheckInLink("#YV-7K2Q4BCD.K7QM2XPA")).toEqual(want);
    expect(readCheckInLink("YV-7K2Q4BCD.k7qm-2xpa")).toEqual(want);
  });

  it("undoes percent escapes a scanner added", () => {
    expect(readCheckInLink("#YV-7K2Q4BCD%2EK7QM2XPA")).toEqual({
      reference: "YV-7K2Q4BCD",
      code: "K7QM2XPA",
    });
  });

  it("reads the last fragment when the router appended one", () => {
    expect(
      readCheckInLink("#YV-7K2Q4BCD.K7QM2XPA#YV-9Q5R2W6C.R4TW9HNE"),
    ).toEqual({ reference: "YV-9Q5R2W6C", code: "R4TW9HNE" });
  });

  it("refuses a link that is not complete", () => {
    expect(readCheckInLink("")).toBeNull();
    expect(readCheckInLink("#")).toBeNull();
    expect(readCheckInLink("#YV-7K2Q4BCD")).toBeNull();
    expect(readCheckInLink("#YV-7K2Q4BCD.")).toBeNull();
    expect(readCheckInLink("#.K7QM2XPA")).toBeNull();
    expect(readCheckInLink("#%E0%A4%A")).toBeNull();
  });

  it("refuses a reference the API would refuse, as it is written", () => {
    // Vowels are not in a reference, and it is not upper-cased for you.
    expect(readCheckInLink("#YV-1A2B3C4D.K7QM2XPA")).toBeNull();
    expect(readCheckInLink("#yv-7k2q4bcd.K7QM2XPA")).toBeNull();
  });
});

describe("holding a link through sign-in", () => {
  afterEach(() => sessionStorage.clear());

  it("gives the held link back once", () => {
    expect(holdCheckInLink("#YV-7K2Q4BCD.K7QM2XPA", 1000)).toBe(true);
    expect(takeHeldCheckInLink(2000)).toEqual({
      reference: "YV-7K2Q4BCD",
      code: "K7QM2XPA",
    });
    expect(takeHeldCheckInLink(2000)).toBeNull();
  });

  it("keeps nothing that is not a check-in link", () => {
    expect(holdCheckInLink("#cash-owed", 1000)).toBe(false);
    expect(holdCheckInLink("", 1000)).toBe(false);
    expect(sessionStorage.length).toBe(0);
  });

  it("lets a held link go stale after 15 minutes", () => {
    holdCheckInLink("#YV-7K2Q4BCD.K7QM2XPA", 0);
    expect(takeHeldCheckInLink(15 * 60 * 1000 + 1)).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("refuses a held link from the future, or one that was tampered with", () => {
    holdCheckInLink("#YV-7K2Q4BCD.K7QM2XPA", 5000);
    expect(takeHeldCheckInLink(1000)).toBeNull();
    sessionStorage.setItem(
      "yvo.check-in",
      JSON.stringify({ reference: "x", code: "y", at: 1000 }),
    );
    expect(takeHeldCheckInLink(1000)).toBeNull();
    sessionStorage.setItem("yvo.check-in", "{");
    expect(takeHeldCheckInLink(1000)).toBeNull();
  });
});
