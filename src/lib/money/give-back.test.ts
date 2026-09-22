import { describe, expect, it } from "vitest";
import { toGiveBack } from "./give-back";

const line = (over: Record<string, unknown> = {}) => ({
  bookingId: "bkg_1",
  reference: "YV-GQZS05HM",
  name: "Meera",
  guests: 2,
  amountPaise: 10_000,
  ...over,
});

describe("cash to give back: yuvoy-operator#95", () => {
  it("is nothing when the API sent nothing, the ordinary case", () => {
    expect(toGiveBack(undefined)).toBeNull();
    expect(toGiveBack(null)).toBeNull();
  });

  it("carries every party with what goes back to them", () => {
    const g = toGiveBack({
      totalPaise: 15_000,
      parties: [line(), line({ bookingId: "bkg_2", amountPaise: 5_000 })],
    });
    expect(g?.totalPaise).toBe(15_000);
    expect(g?.parties.map((p) => p.bookingId)).toEqual(["bkg_1", "bkg_2"]);
    expect(g?.parties[0]).toEqual({
      bookingId: "bkg_1",
      reference: "YV-GQZS05HM",
      name: "Meera",
      guests: 2,
      amountPaise: 10_000,
    });
  });

  it("drops a line with nothing to hand back, and a block left empty", () => {
    expect(
      toGiveBack({ totalPaise: 0, parties: [line({ amountPaise: 0 })] }),
    ).toBeNull();
    expect(toGiveBack({ totalPaise: 0, parties: [] })).toBeNull();
  });

  it("never lets the total disagree with the lines under it", () => {
    const g = toGiveBack({
      totalPaise: 99_999,
      parties: [line(), line({ bookingId: "bkg_2", amountPaise: 5_000 })],
    });
    expect(g?.totalPaise).toBe(15_000);
  });

  it("keeps a party with no name, because the reference still finds them", () => {
    const g = toGiveBack({ totalPaise: 10_000, parties: [line({ name: "" })] });
    expect(g?.parties[0].name).toBe("");
    expect(g?.parties[0].reference).toBe("YV-GQZS05HM");
  });
});
