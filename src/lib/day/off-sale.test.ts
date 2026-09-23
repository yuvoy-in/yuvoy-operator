import { describe, expect, it } from "vitest";
import type { OperatorSlot } from "./types";
import {
  lostSale,
  lostSalesLabel,
  lostSalesOn,
  saleChip,
  seatsUnconfirmed,
} from "./off-sale";

function slot(over: Partial<OperatorSlot> = {}): OperatorSlot {
  return {
    id: "slot_1",
    title: "Sky diving at key west",
    startsAt: "2026-09-24T03:30:00Z",
    timezone: "Asia/Kolkata",
    seats: 8,
    sold: 2,
    remaining: 6,
    status: "open",
    onSale: true,
    ...over,
  };
}

/*
  The day's mark is lost money (yuvoy-operator#84 s7): a live listing whose
  departures were not being sold, with the only clue a sentence nobody
  scrolled to. Every other "no" is a decision already made, the day working,
  or the listing's own business, and marking those would teach an operator to
  ignore the mark.
*/
describe("a lost sale", () => {
  it("is a departure off sale because nobody confirmed its seats", () => {
    expect(
      lostSale(
        slot({
          onSale: false,
          notOnSaleReason: "departure_seats_unconfirmed",
        }),
      ),
    ).toBe(true);
  });

  it("is a departure off sale for the business's documents or standing", () => {
    for (const reason of [
      "credential_missing",
      "credential_expired",
      "operator_not_selling",
      "sales_paused",
    ]) {
      expect(lostSale(slot({ onSale: false, notOnSaleReason: reason }))).toBe(
        true,
      );
    }
  });

  it("is a reason this build has never met, because an unexplained no is the case the mark is for", () => {
    expect(
      lostSale(slot({ onSale: false, notOnSaleReason: "something_new" })),
    ).toBe(true);
    expect(lostSale(slot({ onSale: false }))).toBe(true);
  });

  it("is never a decision already made, or the day working as it should", () => {
    for (const reason of [
      "departure_closed",
      "departure_called_off",
      "departure_past_cutoff",
      "departure_full",
    ]) {
      expect(lostSale(slot({ onSale: false, notOnSaleReason: reason }))).toBe(
        false,
      );
    }
    // Read from the status too, so a response that disagrees with itself
    // still never marks a departure the operator stopped.
    expect(lostSale(slot({ onSale: false, status: "closed" }))).toBe(false);
    expect(lostSale(slot({ onSale: false, status: "cancelled" }))).toBe(false);
  });

  it("is never a departure off sale because its listing is", () => {
    for (const reason of [
      "listing_draft",
      "listing_in_review",
      "listing_withdrawn",
      "listing_unpriced",
    ]) {
      expect(lostSale(slot({ onSale: false, notOnSaleReason: reason }))).toBe(
        false,
      );
    }
  });

  it("is never read into an older API that says nothing about sale", () => {
    const { onSale: _dropped, ...older } = slot();
    void _dropped;
    expect(lostSale(older)).toBe(false);
  });

  it("is counted per day", () => {
    expect(
      lostSalesOn([
        slot({ onSale: false, notOnSaleReason: "departure_seats_unconfirmed" }),
        slot({ onSale: false, notOnSaleReason: "departure_full" }),
        slot({ onSale: false, notOnSaleReason: "credential_expired" }),
        slot(),
      ]),
    ).toBe(2);
    expect(lostSalesLabel(2)).toBe("2 not on sale");
  });
});

describe("seats nobody confirmed", () => {
  it("is only an open departure off sale for exactly that", () => {
    expect(
      seatsUnconfirmed(
        slot({ onSale: false, notOnSaleReason: "departure_seats_unconfirmed" }),
      ),
    ).toBe(true);
    expect(
      seatsUnconfirmed(
        slot({
          onSale: false,
          status: "closed",
          notOnSaleReason: "departure_seats_unconfirmed",
        }),
      ),
    ).toBe(false);
    expect(
      seatsUnconfirmed(
        slot({ onSale: false, notOnSaleReason: "credential_expired" }),
      ),
    ).toBe(false);
  });
});

describe("a departure's chip", () => {
  it("says the fact, and is loud only for a lost sale", () => {
    expect(saleChip(slot())).toBeNull();
    expect(saleChip(slot({ status: "cancelled", onSale: false }))).toEqual({
      label: "Called off",
      loud: false,
    });
    expect(saleChip(slot({ status: "closed", onSale: false }))).toEqual({
      label: "Closed",
      loud: false,
    });
    expect(
      saleChip(slot({ onSale: false, notOnSaleReason: "departure_full" })),
    ).toEqual({ label: "Full", loud: false });
    expect(
      saleChip(
        slot({ onSale: false, notOnSaleReason: "departure_seats_unconfirmed" }),
      ),
    ).toEqual({ label: "Not on sale", loud: true });
    expect(
      saleChip(slot({ onSale: false, notOnSaleReason: "listing_draft" })),
    ).toEqual({ label: "Not on sale", loud: false });
  });
});
