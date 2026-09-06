import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_ROLES,
  canChangeRole,
  canHold,
  canManageAccess,
  canRestore,
  isAssignableRole,
  isHeld,
} from "./access";
import type { TeamPerson } from "./members";

const person = (over: Partial<TeamPerson> = {}): TeamPerson => ({
  id: "usr_x",
  name: "Somebody",
  roles: ["STAFF"],
  pending: false,
  ...over,
});

const ME = "usr_me";
const OWNER = ["OWNER"];
const ADMIN = ["ADMIN"];
const MANAGER = ["MANAGER"];
const STAFF = ["STAFF"];

describe("who may manage access at all", () => {
  it("is OWNER or ADMIN, and never a MANAGER", () => {
    /*
      All four endpoints say "OWNER or ADMIN only". A MANAGER has `canManage`
      — capacity, closed dates, earnings — and none of this, which is why
      `canManage` is not the gate anywhere in this file.
    */
    expect(canManageAccess(OWNER)).toBe(true);
    expect(canManageAccess(ADMIN)).toBe(true);
    expect(canManageAccess(MANAGER)).toBe(false);
    expect(canManageAccess(STAFF)).toBe(false);
    expect(canManageAccess([])).toBe(false);
  });
});

describe("the assignable roles", () => {
  it("does not include OWNER, so it cannot be sent", () => {
    /*
      "`OWNER` cannot be given … the owner is whoever the payout account
      belongs to; that moves deliberately, not from a login." The action's
      schema is built from this list, so a hand-crafted form post carrying
      OWNER is refused before a request exists.
    */
    expect(ASSIGNABLE_ROLES).toEqual(["ADMIN", "MANAGER", "STAFF"]);
    expect(isAssignableRole("OWNER")).toBe(false);
    expect(isAssignableRole("ADMIN")).toBe(true);
    expect(isAssignableRole("nonsense")).toBe(false);
  });
});

describe("a held login", () => {
  it("is recognised by the one state value this portal interprets", () => {
    expect(isHeld(person({ state: "suspended" }))).toBe(true);
    expect(isHeld(person({ state: "active" }))).toBe(false);
    expect(isHeld(person({}))).toBe(false);
  });

  it("degrades in the safe direction on a state nobody knows", () => {
    /*
      `state` has no enum in the contract. If a hold is ever spelled
      differently, the row reads as working and offers Hold — which the API
      answers 404 "not currently working", and the action says so.

      The opposite mistake would tell an owner somebody has no access when
      they do, and that is the direction this screen must never be wrong in.
    */
    const odd = person({ state: "on_hold" });
    expect(isHeld(odd)).toBe(false);
    expect(canHold(odd, ME, OWNER, [odd]).allowed).toBe(true);
    expect(canRestore(odd, ME, OWNER).allowed).toBe(false);
  });
});

describe("changing a role", () => {
  it("is offered by an owner on an ordinary member", () => {
    expect(canChangeRole(person({ roles: STAFF }), ME, OWNER).allowed).toBe(
      true,
    );
  });

  it("is never offered on an owner", () => {
    // "An owner's role cannot be changed here." No reason rendered — the
    // absent control states the rule (§4).
    const r = canChangeRole(person({ roles: OWNER }), ME, OWNER);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it("is never offered on yourself", () => {
    // 409 `cannot_change_access` "including changing your own". And the row
    // has your name on it, so nothing is said.
    const r = canChangeRole(person({ id: ME, roles: ADMIN }), ME, OWNER);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it("is never offered on an invitation", () => {
    // A pending row is a code, not a user. Re-inviting replaces it, which is
    // how an invitation's role is changed.
    expect(
      canChangeRole(person({ pending: true, roles: STAFF }), ME, OWNER).allowed,
    ).toBe(false);
  });

  it("refuses an admin acting on an owner or another admin", () => {
    expect(canChangeRole(person({ roles: OWNER }), ME, ADMIN).allowed).toBe(
      false,
    );
    expect(canChangeRole(person({ roles: ADMIN }), ME, ADMIN).allowed).toBe(
      false,
    );
    expect(canChangeRole(person({ roles: STAFF }), ME, ADMIN).allowed).toBe(
      true,
    );
  });

  it("is not offered to a manager", () => {
    expect(canChangeRole(person({ roles: STAFF }), ME, MANAGER).allowed).toBe(
      false,
    );
  });
});

describe("pausing and restoring", () => {
  it("offers Pause on a working member and Restore on a held one, never both", () => {
    const working = person({ roles: STAFF });
    const held = person({ roles: STAFF, state: "suspended" });

    expect(canHold(working, ME, OWNER, [working]).allowed).toBe(true);
    expect(canRestore(working, ME, OWNER).allowed).toBe(false);

    expect(canHold(held, ME, OWNER, [held]).allowed).toBe(false);
    expect(canRestore(held, ME, OWNER).allowed).toBe(true);
  });

  it("refuses to pause the last owner, and says which refusal it is", () => {
    const owner = person({ id: "usr_owner", roles: OWNER });
    const r = canHold(owner, ME, OWNER, [owner]);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("The only owner.");
  });

  it("allows pausing an owner once there are two", () => {
    const a = person({ id: "usr_owner", roles: OWNER });
    const b = person({ id: ME, roles: OWNER });
    expect(canHold(a, ME, OWNER, [a, b]).allowed).toBe(true);
  });

  it("does not count an unaccepted invitation as an owner", () => {
    /*
      `activeOwnerCount` ignores pending rows on purpose: an invitation cannot
      approve a bank change. So pausing the only ACTIVE owner is still refused
      even with an owner invitation outstanding.
    */
    const owner = person({ id: "usr_owner", roles: OWNER });
    const invited = person({ id: "inv_1", roles: OWNER, pending: true });
    expect(canHold(owner, ME, OWNER, [owner, invited]).allowed).toBe(false);
  });

  it("offers neither on an invitation — revoking is the verb", () => {
    const invite = person({ pending: true, roles: STAFF });
    expect(canHold(invite, ME, OWNER, [invite]).allowed).toBe(false);
    expect(canRestore(invite, ME, OWNER).allowed).toBe(false);
  });

  it("offers neither on yourself", () => {
    const self = person({ id: ME, roles: ADMIN });
    const selfHeld = person({ id: ME, roles: ADMIN, state: "suspended" });
    expect(canHold(self, ME, OWNER, [self]).allowed).toBe(false);
    expect(canRestore(selfHeld, ME, OWNER).allowed).toBe(false);
  });

  it("refuses an admin acting on an owner or another admin", () => {
    const owner = person({ id: "o", roles: OWNER });
    const admin2 = person({ id: "a2", roles: ADMIN });
    const staff = person({ id: "s", roles: STAFF });
    const team = [owner, person({ id: "o2", roles: OWNER }), admin2, staff];

    expect(canHold(owner, ME, ADMIN, team).allowed).toBe(false);
    expect(canHold(admin2, ME, ADMIN, team).allowed).toBe(false);
    expect(canHold(staff, ME, ADMIN, team).allowed).toBe(true);
  });

  it("offers nothing to a manager or to staff", () => {
    const other = person({ id: "s", roles: STAFF });
    for (const roles of [MANAGER, STAFF, []]) {
      expect(canHold(other, ME, roles, [other]).allowed).toBe(false);
      expect(canRestore(other, ME, roles).allowed).toBe(false);
    }
  });
});
