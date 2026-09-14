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
    expect(INVITABLE_ROLES).toEqual(["ADMIN", "MANAGER", "STAFF"]);
    expect(isInvitableRole("OWNER")).toBe(false);
    expect(isInvitableRole("ADMIN")).toBe(true);
    expect(isInvitableRole("MANAGER")).toBe(true);
    expect(isInvitableRole("STAFF")).toBe(true);
  });

  it("refuses anything that is not one of the three", () => {
    // ADMIN moved from this list to the one above when the backend started
    // accepting it (yuvoy-operator#23). The portal went on offering two roles
    // for as long as this test went on asserting two — which is the test doing
    // its job right up until the contract moved and nobody moved it.
    expect(isInvitableRole("")).toBe(false);
    expect(isInvitableRole("staff")).toBe(false);
    expect(isInvitableRole("Admin")).toBe(false);
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
    // Every team write is 403 "OWNER or ADMIN only." A screen that implied
    // otherwise would be teaching an owner something untrue about who can hand
    // out access. "Pause" is in the sentence now because pausing is a thing
    // that exists (yuvoy-api#109).
    expect(describeRole("MANAGER")?.cannot).toMatch(
      /add, remove or pause people/,
    );
  });

  it("does not claim an admin is weaker than a manager — it is not, any more", () => {
    /*
      This copy was WRONG for four days and wrong in the worst direction. It
      said an admin "cannot remove anybody … cannot change seats or see
      earnings", on the strength of `canManage` then excluding ADMIN.

      `canManage` is now "OWNER, ADMIN or MANAGER" — "ADMIN holds it because
      the role exists for an owner who is off the island: one who could add a
      manager but not close a date would be a stand-in for nothing" — and
      `DELETE /team/{id}` widened to OWNER or ADMIN. An owner handing out an
      admin role on the old sentence was being told something untrue about who
      can read their margins.
    */
    const admin = describeRole("ADMIN")!;
    expect(admin.cannot).not.toMatch(/earnings/);
    expect(admin.cannot).not.toMatch(/seats/);
    expect(admin.cannot).not.toMatch(/remove anybody/);

    // What genuinely remains: the bank change is OWNER-only, and an admin may
    // not act on an owner or another admin.
    expect(admin.cannot).toMatch(/payout details/);
    expect(admin.cannot).toMatch(/owner or another admin/);
  });

  it("ranks ADMIN above MANAGER, which is a superset again", () => {
    /*
      `roleRank` was documented as "seniority, not capability" precisely
      because ADMIN and MANAGER did not nest. They do now — ADMIN has
      `canManage` plus the team writes — so collapsing a two-role member to the
      strongest loses nothing.
    */
    expect(roleRank("ADMIN")).toBeGreaterThan(roleRank("MANAGER"));
    expect(strongestRole(["MANAGER", "ADMIN"])).toBe("ADMIN");
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
