import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CLOCK_SLACK_MS,
  MAX_AGE_MS,
  STORAGE_KEY,
  lastBatchFor,
  offlineWrites,
  outcomeLine,
  replayWrites,
  savedLine,
  wasEarlier,
  writesFor,
  type ArrivedWrite,
  type CashWrite,
  type SendAnswer,
  type Senders,
} from "./offline-writes";

/*
  What the phone keeps to send when the signal is back (boarding mode,
  operator experiment D; persistence by owner ruling, 4 Oct 2026: ids, amounts
  and times only, so it survives the phone closing the app at the jetty).
*/

const NOW = Date.parse("2026-10-04T01:00:00Z"); // 06:30 in the market

function arrived(over: Partial<ArrivedWrite> = {}): Omit<ArrivedWrite, "key"> {
  return {
    kind: "arrived",
    userId: "usr_owner",
    slotId: "slot_dawn",
    bookingId: "bkg_asha",
    at: NOW,
    ...over,
  };
}

function cash(over: Partial<CashWrite> = {}): Omit<CashWrite, "key"> {
  return {
    kind: "cash",
    userId: "usr_owner",
    slotId: "slot_dawn",
    bookingId: "bkg_asha",
    at: NOW,
    mode: "fare",
    amount: "",
    amountPaise: 900_000,
    ...over,
  };
}

const NAMES: Record<string, string> = {
  bkg_asha: "Asha Menon",
  bkg_daniel: "Daniel Okafor",
};
const nameOf = (id: string) => NAMES[id] ?? "A party";

beforeEach(() => {
  window.localStorage.clear();
  offlineWrites.reset();
});
afterEach(() => vi.restoreAllMocks());

describe("keeping a write on the phone", () => {
  it("keeps it in storage, so it survives the app closing", () => {
    offlineWrites.add(arrived());
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(stored).toEqual([{ ...arrived(), key: "arrived:bkg_asha" }]);

    // A fresh page (the app was closed and opened again) reads it back.
    offlineWrites.reset();
    expect(offlineWrites.list()).toEqual([
      { ...arrived(), key: "arrived:bkg_asha" },
    ]);
  });

  it("keeps ids, an amount and a time, and nothing a person is found by", () => {
    offlineWrites.add(
      cash({ mode: "less", amount: "8000", amountPaise: 800_000 }),
    );
    const [stored] = JSON.parse(window.localStorage.getItem(STORAGE_KEY)!);
    expect(Object.keys(stored).sort()).toEqual(
      [
        "amount",
        "amountPaise",
        "at",
        "bookingId",
        "key",
        "kind",
        "mode",
        "slotId",
        "userId",
      ].sort(),
    );
  });

  it("keeps the first tap when the same party is tapped again", () => {
    offlineWrites.add(arrived({ at: NOW }));
    offlineWrites.add(arrived({ at: NOW + 60_000 }));
    expect(offlineWrites.list()).toHaveLength(1);
    expect(offlineWrites.list()[0].at).toBe(NOW);
    // A check-in and cash for one party are two things.
    offlineWrites.add(cash());
    expect(offlineWrites.list()).toHaveLength(2);
  });

  it("ignores what it cannot read back, rather than sending it", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { kind: "arrived", key: "arrived:x" },
        { ...arrived(), key: "arrived:bkg_asha" },
        "garbage",
      ]),
    );
    offlineWrites.reset();
    expect(offlineWrites.list().map((w) => w.key)).toEqual([
      "arrived:bkg_asha",
    ]);
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    offlineWrites.reset();
    expect(offlineWrites.list()).toEqual([]);
  });

  it("still keeps it for this page when storage refuses", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    offlineWrites.add(arrived());
    expect(offlineWrites.list()).toHaveLength(1);
  });

  it("is only this person's, and only this departure's when asked", () => {
    offlineWrites.add(arrived());
    offlineWrites.add(
      arrived({ bookingId: "bkg_daniel", userId: "usr_staff" }),
    );
    offlineWrites.add(arrived({ bookingId: "bkg_other", slotId: "slot_cash" }));
    expect(
      writesFor(offlineWrites.list(), "usr_owner").map((w) => w.bookingId),
    ).toEqual(["bkg_asha", "bkg_other"]);
    expect(
      writesFor(offlineWrites.list(), "usr_owner", "slot_dawn").map(
        (w) => w.bookingId,
      ),
    ).toEqual(["bkg_asha"]);
    expect(writesFor(offlineWrites.list(), undefined)).toEqual([]);
  });
});

describe("what the strip says is kept", () => {
  it("counts check-ins and adds up the cash", () => {
    expect(savedLine([])).toBeNull();
    expect(savedLine([{ ...arrived(), key: "a" }])).toBe(
      "1 check-in is saved on this phone.",
    );
    expect(
      savedLine([
        { ...arrived(), key: "a" },
        { ...arrived({ bookingId: "b" }), key: "b" },
        { ...arrived({ bookingId: "c" }), key: "c" },
        { ...cash(), key: "d" },
      ]),
    ).toBe("3 check-ins and ₹9,000 taken are saved on this phone.");
  });

  it("does not invent a total when a fare was not known here", () => {
    expect(
      savedLine([
        { ...cash({ amountPaise: null }), key: "a" },
        { ...cash({ bookingId: "b" }), key: "b" },
      ]),
    ).toBe("cash from 2 parties are saved on this phone.");
  });
});

describe("telling whose tap came first", () => {
  it("counts an answer as somebody else's only when it is well before the tap", () => {
    const at = (offset: number) => new Date(NOW + offset).toISOString();
    expect(wasEarlier(at(-CLOCK_SLACK_MS - 1_000), NOW)).toBe(true);
    // Within the slack: clocks disagree, so it is this phone's own.
    expect(wasEarlier(at(-30_000), NOW)).toBe(false);
    expect(wasEarlier(at(+60_000), NOW)).toBe(false);
    expect(wasEarlier(undefined, NOW)).toBe(false);
    expect(wasEarlier("not a time", NOW)).toBe(false);
  });
});

describe("sending what was kept", () => {
  function senders(answers: {
    arrived?: (w: ArrivedWrite) => SendAnswer;
    cash?: (w: CashWrite) => SendAnswer;
  }): Senders & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async arrived(w) {
        calls.push(w.key);
        return answers.arrived?.(w) ?? { kind: "sent" };
      },
      async cash(w) {
        calls.push(w.key);
        return answers.cash?.(w) ?? { kind: "sent" };
      },
    };
  }

  it("sends this person's oldest first, and lets go of each once answered", async () => {
    offlineWrites.add(arrived({ bookingId: "bkg_daniel", at: NOW + 1 }));
    offlineWrites.add(cash({ at: NOW + 2 }));
    offlineWrites.add(arrived({ at: NOW }));
    offlineWrites.add(arrived({ bookingId: "bkg_x", userId: "usr_staff" }));
    const send = senders({});

    const result = await replayWrites("usr_owner", send, () => NOW + 10);

    // By when each was tapped, not by when it was kept.
    expect(send.calls).toEqual([
      "arrived:bkg_asha",
      "arrived:bkg_daniel",
      "cash:bkg_asha",
    ]);
    expect(result).toEqual({ sent: 3, left: 0 });
    // Somebody else's stays, for when they sign in again.
    expect(offlineWrites.list().map((w) => w.key)).toEqual(["arrived:bkg_x"]);
  });

  it("stops at the first that could not go, and keeps the rest", async () => {
    offlineWrites.add(arrived({ at: NOW }));
    offlineWrites.add(arrived({ bookingId: "bkg_daniel", at: NOW + 1 }));
    const send = senders({ arrived: () => ({ kind: "retry" }) });

    const result = await replayWrites("usr_owner", send, () => NOW + 10);

    expect(send.calls).toEqual(["arrived:bkg_asha"]);
    expect(result).toEqual({ sent: 0, left: 2 });
  });

  it("lets go of a refusal, and says it", async () => {
    offlineWrites.add(arrived());
    await replayWrites(
      "usr_owner",
      senders({
        arrived: () => ({
          kind: "refused",
          message: "Already settled. Refresh to see where it landed.",
        }),
      }),
      () => NOW + 10,
    );
    expect(offlineWrites.list()).toEqual([]);
    const [outcome] = offlineWrites.outcomes();
    expect(outcomeLine(outcome, "Asia/Kolkata", nameOf)).toBe(
      "Asha Menon: Not checked in. Already settled. Refresh to see where it landed.",
    );
  });

  it("says when somebody had already done it, in the market's clock", async () => {
    offlineWrites.add(arrived());
    offlineWrites.add(cash({ bookingId: "bkg_daniel" }));
    await replayWrites(
      "usr_owner",
      senders({
        arrived: () => ({
          kind: "sent",
          earlier: { at: "2026-10-04T01:09:00Z" },
        }),
        cash: () => ({
          kind: "sent",
          earlier: { at: "2026-10-04T01:05:00Z", collectedPaise: 800_000 },
        }),
      }),
      () => NOW + 10,
    );
    const lines = offlineWrites
      .outcomes()
      .map((o) => outcomeLine(o, "Asia/Kolkata", nameOf));
    expect(lines).toEqual([
      "Asha Menon was already checked in at 06:39.",
      "The cash from Daniel Okafor was already recorded at 06:35: ₹8,000.",
    ]);
  });

  it("drops what is over a day old, and says so, rather than sending it", async () => {
    offlineWrites.add(arrived({ at: NOW - MAX_AGE_MS - 1 }));
    const send = senders({});
    await replayWrites("usr_owner", send, () => NOW);
    expect(send.calls).toEqual([]);
    expect(offlineWrites.list()).toEqual([]);
    expect(
      outcomeLine(offlineWrites.outcomes()[0], "Asia/Kolkata", nameOf),
    ).toBe(
      "Asha Menon's check-in was saved on this phone over a day ago and was not sent.",
    );
  });

  it("never runs two sends at once", async () => {
    offlineWrites.add(arrived());
    let release: () => void = () => {};
    const slow: Senders = {
      arrived: () =>
        new Promise<SendAnswer>((resolve) => {
          release = () => resolve({ kind: "sent" });
        }),
      cash: async () => ({ kind: "sent" }),
    };
    const first = replayWrites("usr_owner", slow, () => NOW);
    expect(await replayWrites("usr_owner", slow, () => NOW)).toEqual({
      sent: 0,
      left: -1,
    });
    release();
    expect(await first).toEqual({ sent: 1, left: 0 });
  });

  it("says only the latest send for a departure", async () => {
    offlineWrites.add(arrived());
    await replayWrites("usr_owner", senders({}), () => NOW);
    offlineWrites.add(arrived({ bookingId: "bkg_daniel" }));
    await replayWrites("usr_owner", senders({}), () => NOW);
    expect(
      lastBatchFor(offlineWrites.outcomes(), "slot_dawn").map(
        (o) => o.bookingId,
      ),
    ).toEqual(["bkg_daniel"]);
    expect(lastBatchFor(offlineWrites.outcomes(), "slot_none")).toEqual([]);
  });
});
