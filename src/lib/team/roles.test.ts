import { describe, it, expect } from "vitest";
import {
  INVITABLE_ROLES,
  describeRole,
  isInvitableRole,
  roleLabel,
  roleRank,
  strongestRole,
} from "./roles";

/**
 * Every claim on the team screen is a promise about access, so these tests are
 * about what the copy is allowed to say rather than about formatting.
 */
describe("who may be invited", () => {
  it("never offers OWNER", () => {
    /*
      "OWNER cannot be invited, because the owner is the person whose bank
      account this is, and that is not a thing one login should be able to hand
      to a phone number." The API refuses it; the form must not offer it.
    */
    expect(INVITABLE_ROLES).toEqual(["MANAGER", "STAFF"]);
    expect(isInvitableRole("OWNER")).toBe(false);
    expect(isInvitableRole("MANAGER")).toBe(true);
    expect(isInvitableRole("STAFF")).toBe(true);
  });

  it("refuses anything that is not one of the two", () => {
    expect(isInvitableRole("ADMIN")).toBe(false);
    expect(isInvitableRole("")).toBe(false);
    expect(isInvitableRole("staff")).toBe(false);
  });
});

describe("a member holding more than one role", () => {
  it("is described by the strongest, because the roles nest", () => {
    expect(strongestRole(["STAFF", "MANAGER"])).toBe("MANAGER");
    expect(strongestRole(["MANAGER", "OWNER"])).toBe("OWNER");
    expect(strongestRole(["STAFF"])).toBe("STAFF");
  });

  it("ignores a role this build does not know about", () => {
    // Ranked 0 deliberately: an unknown role must never become the one a
    // description is derived from.
    expect(roleRank("AUDITOR")).toBe(0);
    expect(strongestRole(["STAFF", "AUDITOR"])).toBe("STAFF");
  });

  it("has no strongest role when it holds none we know", () => {
    expect(strongestRole(["AUDITOR"])).toBeNull();
    expect(strongestRole([])).toBeNull();
  });
});

describe("what each role is told it can do", () => {
  it("gives OWNER no ceiling, and both others one", () => {
    expect(describeRole("OWNER")?.cannot).toBeUndefined();
    expect(describeRole("MANAGER")?.cannot).toMatch(/payout details/);
    expect(describeRole("STAFF")?.cannot).toMatch(/cannot answer them/);
  });

  it("says a manager cannot manage the team, because the API refuses it", () => {
    // `POST /team` and `DELETE /team/{id}` are both 403 "OWNER only." A screen
    // that implied otherwise would be teaching an owner something untrue about
    // who can hand out access.
    expect(describeRole("MANAGER")?.cannot).toMatch(/add or remove people/);
  });

  it("claims nothing at all about a role it does not know", () => {
    /*
      Not a weakest-role fallback. Telling an owner somebody has LESS access
      than they really do is the one direction this screen must never be wrong
      in — it is the direction that gets a phone handed over.
    */
    expect(describeRole("AUDITOR")).toBeNull();
    expect(roleLabel("AUDITOR")).toBe("AUDITOR");
    expect(roleLabel("STAFF")).toBe("Staff");
  });
});
