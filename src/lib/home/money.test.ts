import { describe, expect, it } from "vitest";
import { moneyLine, type MoneyWeek } from "./money";

const TODAY = "2026-09-24"; // a Thursday

const thisWeek: MoneyWeek = {
  periodStart: "2026-09-21",
  periodEnd: "2026-09-27",
  settlesFrom: "2026-09-28",
  netPaise: 4_015_000,
};

/*
  yuvoy-operator#96 block 4: "This week ₹X · next payout Mon 28 Sep · cash
  owed to Yuvoy ₹2,250".
*/
describe("money today, in one line", () => {
  it("says the week, when it can be paid, and what is owed on cash", () => {
    expect(
      moneyLine({ week: thisWeek, owedPaise: 225_000, today: TODAY }),
    ).toEqual({
      text: "This week ₹40,150 · payout from Mon 28 Sep · cash owed to Yuvoy ₹2,250",
      owedBack: false,
    });
  });

  it("names last week as last week, and a payout whose day has come as due", () => {
    /*
      `nextSettlement` is LAST week while nobody has locked it, so calling it
      this week's would be a figure somebody plans against wrongly.
    */
    expect(
      moneyLine({
        week: {
          periodStart: "2026-09-14",
          periodEnd: "2026-09-20",
          settlesFrom: "2026-09-21",
          netPaise: 1_000_000,
        },
        owedPaise: 0,
        today: TODAY,
      })?.text,
    ).toBe("Last week ₹10,000 · payout due");
  });

  it("names an older unpaid week by its Monday", () => {
    expect(
      moneyLine({
        week: {
          periodStart: "2026-09-07",
          periodEnd: "2026-09-13",
          settlesFrom: "2026-09-14",
          netPaise: 4_015_000,
        },
        owedPaise: 450_000,
        today: "2026-09-22",
      })?.text,
    ).toBe(
      "Week of Mon 7 Sep ₹40,150 · payout due · cash owed to Yuvoy ₹4,500",
    );
  });

  it("keeps the minus sign on a week that pays less than nothing", () => {
    const line = moneyLine({
      week: { ...thisWeek, netPaise: -217_500 },
      owedPaise: null,
      today: TODAY,
    });
    expect(line?.text).toMatch(/^This week -₹2,175 /);
    expect(line?.owedBack).toBe(true);
  });

  it("leaves out nothing owed, and says the cash half alone when the week did not load", () => {
    expect(
      moneyLine({ week: null, owedPaise: 225_000, today: TODAY })?.text,
    ).toBe("Cash owed to Yuvoy ₹2,250");
    expect(moneyLine({ week: null, owedPaise: 0, today: TODAY })?.text).toBe(
      "Nothing owed on cash",
    );
  });

  it("is nothing at all when neither read answered", () => {
    expect(moneyLine({ week: null, owedPaise: null, today: TODAY })).toBeNull();
  });
});
