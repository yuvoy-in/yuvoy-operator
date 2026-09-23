import { describe, expect, it } from "vitest";
import type { Blocker, Standing } from "@/lib/account/standing";
import type { HomeListing } from "./listings";
import { sellingStatus } from "./status";

const standing = (over: Partial<Standing> = {}): Standing => ({
  state: "LIVE",
  bookable: true,
  blocking: [],
  credentials: [],
  requiredDocuments: [],
  ...over,
});

const listing = (over: Partial<HomeListing> = {}): HomeListing => ({
  id: "exp_1",
  title: "Dawn dive",
  status: "live",
  publicationState: "published",
  sentBack: false,
  bookableDatesNext30Days: 12,
  departuresNotOnSale: 0,
  departuresGoingOffSaleSoon: 0,
  ...over,
});

const document = (label: string): Blocker => ({
  code: "CREDENTIAL_MISSING",
  label,
  waitingOn: "operator",
  gates: true,
});

const base = {
  standing: standing(),
  suspension: null,
  listings: [listing(), listing({ id: "exp_2" }), listing({ id: "exp_3" })],
  canManage: true,
};

/*
  yuvoy-operator#96 block 1: "Green 'Selling · 3 listings live'. Amber
  'Selling, but 19 departures are off sale'. Red 'Not selling: 2 documents
  needed'. Tap opens the reasons."
*/
describe("whether the business is selling", () => {
  it("says it is selling, and how much is live, when nothing is wrong", () => {
    expect(sellingStatus(base)).toEqual({
      tone: "selling",
      line: "Selling · 3 listings live",
      reasons: [],
    });
  });

  it("says selling, but, when departures are off sale", () => {
    const status = sellingStatus({
      ...base,
      listings: [
        listing({ departuresNotOnSale: 18 }),
        listing({ id: "exp_2", departuresNotOnSale: 1 }),
      ],
    });
    expect(status.tone).toBe("attention");
    expect(status.line).toBe("Selling, but 19 departures are off sale");
    expect(status.reasons[0].text).toBe(
      "19 departures are off sale: seats not confirmed",
    );
  });

  it("names the one live listing with nothing to sell, and opens its hub", () => {
    const status = sellingStatus({
      ...base,
      listings: [
        listing(),
        listing({
          id: "exp_t2",
          title: "test2Activity",
          bookableDatesNext30Days: 0,
        }),
      ],
    });
    expect(status.line).toBe("Selling, but test2Activity has no dates to sell");
    expect(status.reasons).toEqual([
      {
        text: "test2Activity has no dates in the next 30 days",
        href: "/today/listing/exp_t2",
        action: "Add departures",
      },
    ]);
  });

  it("offers a staff login no way it would be refused", () => {
    const status = sellingStatus({
      ...base,
      canManage: false,
      listings: [listing({ bookableDatesNext30Days: 0 })],
    });
    expect(status.reasons[0]).toEqual({
      text: "Dawn dive has no dates in the next 30 days",
    });
  });

  it("warns before anything goes off sale", () => {
    const status = sellingStatus({
      ...base,
      listings: [listing({ departuresGoingOffSaleSoon: 1 })],
    });
    expect(status.line).toBe(
      "Selling, but 1 departure goes off sale within a day",
    );
  });

  it("says not selling, and how many documents, when the account cannot sell", () => {
    const status = sellingStatus({
      ...base,
      standing: standing({
        bookable: false,
        blocking: [
          document("We still need your tourism department registration"),
          document("We still need your insurance certificate"),
        ],
      }),
    });
    expect(status.tone).toBe("blocked");
    expect(status.line).toBe("Not selling: 2 documents needed");
    // And where the whole of it is, documents and all.
    expect(status.more).toEqual({
      href: "/account/verification",
      action: "See everything on Verification",
    });
    expect(status.reasons).toEqual([
      {
        text: "We still need your tourism department registration",
        href: "/profile#documents",
        action: "Send us the document",
      },
      {
        text: "We still need your insurance certificate",
        href: "/profile#documents",
        action: "Send us the document",
      },
    ]);
  });

  it("counts things, not documents, when the blockers are mixed", () => {
    const status = sellingStatus({
      ...base,
      standing: standing({
        bookable: false,
        blocking: [
          document("We still need your insurance certificate"),
          {
            code: "BUSINESS_DETAILS_INCOMPLETE",
            label: "We still need your registered address",
            waitingOn: "operator",
            gates: true,
          },
        ],
      }),
    });
    expect(status.line).toBe("Not selling: 2 things need you");
  });

  it("says it is with Yuvoy when nothing is waiting on the operator", () => {
    const status = sellingStatus({
      ...base,
      standing: standing({
        bookable: false,
        blocking: [
          {
            code: "AWAITING_REVIEW",
            label: "Everything is in. A person at Yuvoy is checking it.",
            waitingOn: "yuvoy",
            gates: true,
          },
        ],
      }),
    });
    expect(status.line).toBe("Not selling yet: Yuvoy is checking your account");
    // Nothing to tap on something that waits on us.
    expect(status.reasons[0]).not.toHaveProperty("href");
  });

  it("says the account is on hold, in the API's own words, with the call to make", () => {
    const status = sellingStatus({
      ...base,
      suspension: {
        message:
          "your account has been suspended. Please reach out to admin for help",
      },
    });
    expect(status).toEqual({
      tone: "blocked",
      line: "Not selling: your account is on hold",
      reasons: [
        {
          text: "Your account has been suspended. Please reach out to admin for help.",
          href: "tel:+918121657657",
          action: "Call Yuvoy",
        },
      ],
    });
  });

  it("never says selling when the API did not say where the account stands", () => {
    const status = sellingStatus({ ...base, standing: null });
    expect(status.tone).toBe("unknown");
    expect(status.line).not.toMatch(/^Selling/);
  });

  it("says the account is live, and no more, when the listings did not load", () => {
    expect(sellingStatus({ ...base, listings: null })).toEqual({
      tone: "selling",
      line: "Your account is live",
      reasons: [],
    });
  });

  it("says not selling when nothing is live, and which listing cannot sell", () => {
    const status = sellingStatus({
      ...base,
      listings: [
        listing({ status: "draft", publicationState: "draft" }),
        listing({ id: "exp_ns", title: "Coral wall", status: "not_selling" }),
      ],
    });
    expect(status.tone).toBe("attention");
    expect(status.line).toBe("Not selling: no listing is live");
    expect(status.reasons).toEqual([
      {
        text: "Coral wall is published but not selling",
        href: "/account/listings/exp_ns",
        action: "See why",
      },
    ]);
    expect(sellingStatus({ ...base, listings: [] }).line).toBe(
      "Not selling yet: no listings",
    );
  });
});
