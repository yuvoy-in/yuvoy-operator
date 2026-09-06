import { describe, expect, it } from "vitest";
import {
  canEdit,
  entityLabel,
  gstinIssue,
  isEntityType,
  isMissing,
  toFormValues,
  type BusinessDetails,
} from "./details";

describe("whether the form may be edited", () => {
  it("is editable only when the API says so", () => {
    expect(canEdit({ editable: true })).toBe(true);
    expect(canEdit({ editable: false })).toBe(false);
  });

  it("treats an absent flag as LOCKED, not as permission", () => {
    /*
      The safe direction. Offering a form that answers `409 details_locked`
      teaches an operator the screen lies; a read-only form on an account that
      could have been edited costs one message to us.
    */
    expect(canEdit({})).toBe(false);
    expect(canEdit(null)).toBe(false);
  });
});

describe("the fields still outstanding", () => {
  const details: BusinessDetails = {
    missing: ["legalName", "address.postalCode"],
  };

  it("marks the exact rows the API named", () => {
    // "Named rather than a bare boolean so a form can mark the specific rows."
    expect(isMissing(details, "legalName")).toBe(true);
    expect(isMissing(details, "entityType")).toBe(false);
  });

  it("matches an address field whichever shape the API names it in", () => {
    /*
      `GET` nests the address; `PUT` takes it flat. Matching loosely is right:
      marking a row nobody named costs nothing, and missing one leaves an
      operator hunting for the field nobody highlighted.
    */
    expect(isMissing(details, "postalCode")).toBe(true);
  });

  it("marks nothing when the API named nothing", () => {
    expect(isMissing({ missing: [] }, "legalName")).toBe(false);
    expect(isMissing(null, "legalName")).toBe(false);
  });
});

describe("the form's initial values", () => {
  it("flattens the address the API nests", () => {
    // The GET/PUT asymmetry is reconciled in exactly one place.
    const values = toFormValues({
      legalName: "Nemo Reef Watersports",
      entityType: "sole_proprietor",
      address: { line1: "Beach 3", locality: "Havelock", country: "IN" },
    });
    expect(values).toMatchObject({
      legalName: "Nemo Reef Watersports",
      entityType: "sole_proprietor",
      addressLine1: "Beach 3",
      locality: "Havelock",
      country: "IN",
    });
  });

  it("gives every field a string, so no input flips controlled to uncontrolled", () => {
    const values = toFormValues(null);
    for (const value of Object.values(values)) {
      expect(typeof value).toBe("string");
    }
  });
});

describe("entity types", () => {
  it("accepts only what the contract enumerates", () => {
    expect(isEntityType("llp")).toBe(true);
    expect(isEntityType("private_limited")).toBe(true);
    expect(isEntityType("charity")).toBe(false);
    expect(isEntityType("")).toBe(false);
  });

  it("shows the words an accountant uses, not a prettified enum", () => {
    // "LLP", not "Llp".
    expect(entityLabel("llp")).toBe("LLP");
    expect(entityLabel("private_limited")).toBe("Private limited");
  });

  it("falls back to the raw value rather than claiming nothing", () => {
    expect(entityLabel("co_operative")).toBe("co_operative");
    expect(entityLabel(undefined)).toBeNull();
  });
});

describe("GSTIN", () => {
  it("accepts blank, because plenty of operators are under the threshold", () => {
    /*
      "Demanding a number they cannot legally obtain would block exactly the
      businesses this marketplace exists for."
    */
    expect(gstinIssue("")).toBeNull();
    expect(gstinIssue("   ")).toBeNull();
  });

  it("checks the length and nothing else", () => {
    expect(gstinIssue("22AAAAA0000A1Z5")).toBeNull();
    expect(gstinIssue("22AAAAA0000A1Z")).toMatch(/15 characters/);
  });

  it("does not reimplement the checksum", () => {
    /*
      A client that validated the check digit would refuse a valid number the
      day the algorithm or the state-code table changed. Fifteen characters is
      the whole rule this portal enforces; the server owns the rest.
    */
    expect(gstinIssue("000000000000000")).toBeNull();
  });
});
