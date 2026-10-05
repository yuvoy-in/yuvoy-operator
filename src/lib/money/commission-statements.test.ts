import { describe, expect, it } from "vitest";
import {
  owedOf,
  payee,
  paymentsAddUp,
  rateLabel,
  statementLinesAddUp,
  statementState,
  statementStateLine,
  statementsForMoney,
  statementsOwing,
  totalOwed,
  tripsLabel,
  upiPayLink,
  type CommissionStatement,
} from "./commission-statements";

/*
  Yuvoy's commission on cash trips, billed weekly (yuvoy-operator#121,
  D-043). What a screen calls "owed" comes from here, so these are the
  promises that matter: a waived statement owes nothing, a total is never
  smaller than the bill, and a pay link is only ever a `upi://pay` link that
  pays what the screen says, to whom it says.
*/

function statement(
  over: Partial<CommissionStatement> = {},
): CommissionStatement {
  return {
    id: "cst_1",
    reference: "YC-7KQ2MZ9P",
    weekStart: "2026-09-21",
    weekEnd: "2026-09-27",
    state: "issued",
    bookings: 2,
    farePaise: 1_500_000,
    commissionPaise: 225_000,
    paidPaise: 0,
    owedPaise: 225_000,
    issuedAt: "2026-09-29T03:30:00Z",
    ...over,
  };
}

const PART_PAID = statement({
  id: "cst_2",
  state: "part_paid",
  commissionPaise: 330_000,
  paidPaise: 200_000,
  owedPaise: 130_000,
});
const PAID = statement({
  id: "cst_3",
  state: "paid",
  paidPaise: 225_000,
  owedPaise: 0,
});
const WAIVED = statement({
  id: "cst_4",
  state: "waived",
  owedPaise: 0,
  waivedAt: "2026-09-20T06:00:00Z",
});

describe("a statement's state", () => {
  it("reads the two states with something to pay as needing doing", () => {
    expect(statementState(statement())).toEqual({
      label: "To pay",
      tone: "accent",
    });
    expect(statementState(PART_PAID)).toEqual({
      label: "Part paid",
      tone: "accent",
    });
  });

  it("reads a waived statement as settled, never as paid", () => {
    expect(statementState(PAID).label).toBe("Paid");
    expect(statementState(WAIVED)).toEqual({
      label: "Settled",
      tone: "neutral",
    });
  });

  it("draws a state it has never heard of from what is owed on it", () => {
    const unknown = (owedPaise: number) =>
      statementState({
        state: "disputed" as CommissionStatement["state"],
        owedPaise,
      });
    expect(unknown(5_000).label).toBe("To pay");
    expect(unknown(0).label).toBe("Paid");
  });
});

describe("what is owed on one statement", () => {
  it("is the API's figure while there is something to pay", () => {
    expect(owedOf(statement())).toBe(225_000);
    expect(owedOf(PART_PAID)).toBe(130_000);
  });

  it("is nothing on a waived statement, whatever its figures read", () => {
    // "0 once the statement is waived", held here as well as trusted.
    expect(owedOf({ state: "waived", owedPaise: 95_000 })).toBe(0);
  });

  it("is unknown, never ₹0, when the figure is not whole paise", () => {
    expect(owedOf({ state: "issued", owedPaise: 12.5 })).toBeNull();
    expect(owedOf({ state: "issued", owedPaise: -100 })).toBeNull();
    expect(
      owedOf({ state: "issued", owedPaise: undefined as unknown as number }),
    ).toBeNull();
  });
});

describe("what is owed across the statements", () => {
  const ALL = [statement(), PART_PAID, PAID, WAIVED];

  it("adds up every statement still to pay", () => {
    expect(totalOwed(ALL)).toBe(355_000);
    expect(statementsOwing(ALL)).toBe(2);
  });

  it("is nothing owed with no statements", () => {
    expect(totalOwed([])).toBe(0);
  });

  it("will not add up a list that was cut short", () => {
    // A total missing a statement understates the bill.
    expect(totalOwed(ALL, false)).toBeNull();
  });

  it("will not add up past a statement that does not say what it owes", () => {
    expect(
      totalOwed([statement(), statement({ id: "x", owedPaise: Number.NaN })]),
    ).toBeNull();
  });
});

describe("the statements the Money tab lists", () => {
  it("keeps every statement still to pay, however many, then the newest settled", () => {
    const list = [PAID, statement(), WAIVED, PART_PAID];
    expect(statementsForMoney(list, 3)).toEqual({
      shown: [PAID, statement(), PART_PAID],
      more: 1,
    });
  });

  it("never pushes a bill off the tab to make room", () => {
    const bills = [
      statement({ id: "a" }),
      statement({ id: "b" }),
      statement({ id: "c" }),
      statement({ id: "d" }),
    ];
    const { shown, more } = statementsForMoney([PAID, ...bills], 3);
    expect(shown.map((s) => s.id)).toEqual(["a", "b", "c", "d"]);
    expect(more).toBe(1);
  });
});

describe("the link that opens a UPI app", () => {
  const LINK =
    "upi://pay?pa=yuvoy.dev@example&pn=Yuvoy%20(dev)&am=2250.00&cu=INR&tn=YC-7KQ2MZ9P";

  it("reads the API's own escaping: the @ as %40, spaces as %20", () => {
    // yuvoy-api upiLink: url.QueryEscape, then "+" as "%20".
    const escaped =
      "upi://pay?pa=yuvoy.dev%40example&pn=Yuvoy%20%28dev%29&am=2250.00&cu=INR&tn=YC-7KQ2MZ9P";
    expect(
      upiPayLink(
        { available: true, upiId: "yuvoy.dev@example", upiLink: escaped },
        225_000,
      ),
    ).toBe(escaped);
  });
  const PAY_TO = {
    available: true,
    upiId: "yuvoy.dev@example",
    payee: "Yuvoy (dev)",
    upiLink: LINK,
  };

  it("is the API's link when it pays what the screen says, to whom it says", () => {
    expect(upiPayLink(PAY_TO, 225_000)).toBe(LINK);
    // Case and a stray space in the UPI ID are not a different payee.
    expect(
      upiPayLink({ ...PAY_TO, upiId: " Yuvoy.Dev@Example " }, 225_000),
    ).toBe(LINK);
    // An amount is optional in a UPI link.
    const noAmount = "upi://pay?pa=yuvoy.dev@example&cu=INR&tn=YC-7KQ2MZ9P";
    expect(upiPayLink({ ...PAY_TO, upiLink: noAmount }, 225_000)).toBe(
      noAmount,
    );
  });

  it("is never anything but a upi://pay link", () => {
    for (const upiLink of [
      "javascript:alert(1)",
      "https://pay.example/upi?pa=yuvoy.dev@example",
      "upi://mandate?pa=yuvoy.dev@example",
      "upi://pay?",
      "",
    ]) {
      expect(upiPayLink({ ...PAY_TO, upiLink }, 225_000), upiLink).toBeNull();
    }
  });

  it("is nothing when it would pay somebody else, or another amount", () => {
    expect(
      upiPayLink(
        {
          ...PAY_TO,
          upiLink: LINK.replace("yuvoy.dev@example", "other@okaxis"),
        },
        225_000,
      ),
    ).toBeNull();
    expect(upiPayLink(PAY_TO, 130_000)).toBeNull();
    expect(
      upiPayLink(
        { ...PAY_TO, upiLink: LINK.replace("2250.00", "2,250") },
        225_000,
      ),
    ).toBeNull();
  });

  it("is nothing when paying is not set up", () => {
    expect(upiPayLink({ ...PAY_TO, available: false }, 225_000)).toBeNull();
    expect(upiPayLink({ ...PAY_TO, upiLink: undefined }, 225_000)).toBeNull();
  });

  it("reads paise in the amount exactly", () => {
    const link = LINK.replace("2250.00", "1300.50");
    expect(upiPayLink({ ...PAY_TO, upiLink: link }, 130_050)).toBe(link);
  });
});

describe("where to pay", () => {
  it("is the UPI ID and the payee, both there", () => {
    expect(
      payee({ available: true, upiId: " yuvoy@okaxis ", payee: "Yuvoy" }),
    ).toEqual({ upiId: "yuvoy@okaxis", name: "Yuvoy" });
  });

  it("is not set up when either is missing, rather than drawn half-empty", () => {
    expect(payee({ available: true, upiId: "yuvoy@okaxis" })).toBeNull();
    expect(payee({ available: true, payee: "Yuvoy" })).toBeNull();
    expect(
      payee({ available: false, upiId: "yuvoy@okaxis", payee: "Yuvoy" }),
    ).toBeNull();
  });
});

describe("the words on a statement", () => {
  it("writes the frozen rate from basis points", () => {
    expect(rateLabel(1500)).toBe("15%");
    expect(rateLabel(1250)).toBe("12.5%");
    expect(rateLabel(1333)).toBe("13.33%");
    expect(rateLabel(Number.NaN)).toBe("");
  });

  it("counts trips", () => {
    expect(tripsLabel(1)).toBe("1 trip");
    expect(tripsLabel(3)).toBe("3 trips");
  });

  it("says where each state stands, on the market's calendar", () => {
    // 03:30 UTC is 09:00 in the market, on the Tuesday it was issued.
    expect(statementStateLine(statement())).toBe(
      "Issued on 29 September 2026. Nothing paid yet.",
    );
    expect(statementStateLine(PART_PAID)).toBe(
      "Part paid. ₹1,300 still to pay.",
    );
    expect(statementStateLine(PAID)).toBe("Paid in full.");
    expect(statementStateLine(WAIVED)).toBe(
      "Settled on 20 September 2026. Nothing more to pay.",
    );
  });

  it("names the market's day, not the server's, for an instant near midnight", () => {
    // 19:00 UTC on the 28th is half past midnight on the 29th in the market.
    expect(
      statementStateLine(statement({ issuedAt: "2026-09-28T19:00:00Z" })),
    ).toBe("Issued on 29 September 2026. Nothing paid yet.");
  });

  it("leaves out a day it cannot read rather than print a wrong one", () => {
    expect(statementStateLine(statement({ issuedAt: "soon" }))).toBe(
      "Nothing paid yet.",
    );
    expect(statementStateLine({ ...WAIVED, waivedAt: undefined })).toBe(
      "Settled. Nothing more to pay.",
    );
  });
});

describe("whether a statement adds up", () => {
  const LINES = [{ commissionPaise: 150_000 }, { commissionPaise: 75_000 }];

  it("does when its trips account for what it bills", () => {
    expect(statementLinesAddUp(statement(), LINES)).toBe(true);
  });

  it("does not when a trip is missing or a figure is off", () => {
    expect(statementLinesAddUp(statement(), LINES.slice(0, 1))).toBe(false);
    expect(
      statementLinesAddUp(statement(), [
        { commissionPaise: 150_000 },
        { commissionPaise: 74_999 },
      ]),
    ).toBe(false);
  });

  it("checks the payments against what is recorded as paid", () => {
    expect(paymentsAddUp(PART_PAID, [{ amountPaise: 200_000 }])).toBe(true);
    expect(paymentsAddUp(statement(), [])).toBe(true);
    expect(paymentsAddUp(PART_PAID, [])).toBe(false);
  });
});
