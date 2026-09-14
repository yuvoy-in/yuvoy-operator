import { describe, it, expect } from "vitest";
import {
  activeOwnerCount,
  lastSeen,
  removability,
  splitTeam,
  toTeamPerson,
  type TeamPerson,
} from "./members";

const person = (over: Partial<TeamPerson>): TeamPerson => ({
  id: "usr_1",
  name: "Somebody",
  roles: ["STAFF"],
  pending: false,
  ...over,
});

describe("an invitation is not a person", () => {
  it("keeps them in separate lists", () => {
    /*
      `GET /team` returns both "in one list", and the contract is explicit that
      on a pending row `id` is the INVITATION, not a user. Rendering them
      together makes that a footnote; splitting them lets the screen say two
      different things.
    */
    const { people, invitations } = splitTeam([
      person({ id: "usr_a", name: "Asha", roles: ["OWNER"] }),
      person({ id: "inv_b", name: "Ravi", roles: ["STAFF"], pending: true }),
    ]);
    expect(people.map((p) => p.id)).toEqual(["usr_a"]);
    expect(invitations.map((p) => p.id)).toEqual(["inv_b"]);
  });

  it("puts the strongest role first, then sorts by name", () => {
    const { people } = splitTeam([
      person({ id: "3", name: "Zara", roles: ["STAFF"] }),
      person({ id: "1", name: "Asha", roles: ["OWNER"] }),
      person({ id: "2", name: "Bo", roles: ["MANAGER"] }),
      person({ id: "4", name: "Ana", roles: ["STAFF"] }),
    ]);
    expect(people.map((p) => p.name)).toEqual(["Asha", "Bo", "Ana", "Zara"]);
  });

  it("does not count an unaccepted invitation as an owner", () => {
    // An invitation cannot approve a bank change or receive a step-up code,
    // so it cannot be the owner that makes removing the real one safe.
    const team = [
      person({ id: "usr_a", roles: ["OWNER"] }),
      person({ id: "inv_b", roles: ["OWNER"], pending: true }),
    ];
    expect(activeOwnerCount(team)).toBe(1);
  });
});

describe("narrowing what the API returned", () => {
  it("treats a missing `pending` as not pending", () => {
    // `pending` absent is not `true` — the same rule as `declaredClear` on the
    // traveller side. An unmarked row is an active member.
    expect(toTeamPerson({ id: "x" }).pending).toBe(false);
    expect(toTeamPerson({ id: "x", pending: true }).pending).toBe(true);
  });

  it("passes the masked number through, and refuses anything that is not a mask", () => {
    /*
      `phoneMasked` is four digits behind bullets, masked in SQL before it
      reaches the API process (yuvoy-api#62). If a future contract ever put
      more of the number here, this portal must not become the directory of an
      operator's staff that the mask exists to prevent — so more than four
      digits renders as nothing rather than as a number.
    */
    expect(toTeamPerson({ phoneMasked: "••••0132" }).phoneMasked).toBe(
      "••••0132",
    );
    expect(toTeamPerson({}).phoneMasked).toBeUndefined();
    expect(toTeamPerson({ phoneMasked: "" }).phoneMasked).toBeUndefined();
    expect(
      toTeamPerson({ phoneMasked: "+919000000132" }).phoneMasked,
    ).toBeUndefined();
  });

  it("passes `state` through rather than branching on it", () => {
    // The contract types `state` as a bare string with no enum, so this build
    // does not know its values and must not pretend to.
    expect(toTeamPerson({ state: "suspended" }).state).toBe("suspended");
    expect(toTeamPerson({}).state).toBeUndefined();
    expect(toTeamPerson({}).roles).toEqual([]);
  });
});

describe("who may be removed", () => {
  const me = "usr_me";
  const OWNER = ["OWNER"];
  const ADMIN = ["ADMIN"];

  it("refuses to remove yourself, and says nothing about it", () => {
    /*
      yuvoy-operator#25 §4. It used to read "This is you. Another owner has to
      remove you." — a sentence explaining an internal rule beside a row with
      the reader's own name on it. Not offering the control says it.
    */
    const team = [
      person({ id: me, roles: OWNER }),
      person({ id: "usr_2", roles: OWNER }),
    ];
    const r = removability(team[0], me, OWNER, team);
    expect(r.removable).toBe(false);
    expect(r.reason).toBeUndefined();
  });

  it("refuses to remove the last owner, and that one DOES say why", () => {
    /*
      The one reason that survives the cut. An owner would read a missing
      Remove here as a bug, and it is not inferable from the row — but it is
      stated as a fact with no next step, because there is none: an owner
      cannot be invited from this portal.
    */
    const team = [
      person({ id: "usr_owner", roles: OWNER }),
      person({ id: me, roles: OWNER }),
    ];
    const only = [team[0]];
    const r = removability(team[0], me, OWNER, only);
    expect(r.removable).toBe(false);
    expect(r.reason).toBe("The only owner.");
  });

  it("allows removing an owner once there are two", () => {
    const team = [
      person({ id: "usr_owner", roles: OWNER }),
      person({ id: me, roles: OWNER }),
    ];
    expect(removability(team[0], me, OWNER, team).removable).toBe(true);
  });

  it("lets an ADMIN remove, which used to be OWNER only", () => {
    // `DELETE /team/{id}` widened to "OWNER or ADMIN" in yuvoy-api#109. An
    // admin exists because the owner may be off the island.
    const team = [
      person({ id: me, roles: ADMIN }),
      person({ id: "usr_staff", roles: ["STAFF"] }),
    ];
    expect(removability(team[1], me, ADMIN, team).removable).toBe(true);
  });

  it("does not let an ADMIN remove an owner or another admin", () => {
    // "An ADMIN cannot change an OWNER or another ADMIN" — 403.
    const team = [
      person({ id: me, roles: ADMIN }),
      person({ id: "usr_owner", roles: OWNER }),
      person({ id: "usr_admin2", roles: ADMIN }),
    ];
    expect(removability(team[1], me, ADMIN, team).removable).toBe(false);
    expect(removability(team[2], me, ADMIN, team).removable).toBe(false);
  });

  it("offers nothing at all to a MANAGER", () => {
    /*
      `canManage` is "OWNER, ADMIN or MANAGER" and gates capacity, earnings and
      listing edits — never this. A manager who could remove people could hand
      out access to a business that is not theirs.
    */
    const team = [
      person({ id: me, roles: ["MANAGER"] }),
      person({ id: "usr_staff", roles: ["STAFF"] }),
    ];
    expect(removability(team[1], me, ["MANAGER"], team).removable).toBe(false);
  });

  it("allows revoking an invitation, including one to an owner", () => {
    /*
      Defensive rather than expected: OWNER cannot be invited, so this row
      should not exist. If it ever does, revoking a code nobody has used never
      leaves the account ownerless — the guard is about active owners.
    */
    const team = [
      person({ id: "usr_owner", roles: OWNER }),
      person({ id: "inv_x", roles: OWNER, pending: true }),
    ];
    expect(removability(team[1], me, OWNER, team).removable).toBe(true);
  });

  it("does not mistake an invitation id for your own user id", () => {
    // Both are opaque strings from the same endpoint. A pending row is an
    // invitation and can never be "you", whatever its id happens to be.
    const team = [person({ id: me, pending: true })];
    expect(removability(team[0], me, OWNER, team).removable).toBe(true);
  });
});

describe("last seen", () => {
  // 1 September 2026, 09:00 IST.
  const now = Date.parse("2026-09-01T09:00:00+05:30");

  it("counts days in the market's zone, not the device's", () => {
    /*
      03:00 IST on the 1st is 21:30 UTC on 31 August. Counted in UTC this
      would read "yesterday" to an operator who is standing in it.
    */
    expect(lastSeen("2026-08-31T21:35:00Z", now)).toBe("Last seen today");
    expect(lastSeen("2026-08-31T10:00:00+05:30", now)).toBe(
      "Last seen yesterday",
    );
    expect(lastSeen("2026-08-28T10:00:00+05:30", now)).toBe(
      "Last seen 4 days ago",
    );
  });

  it("stops counting past a month and changes the question", () => {
    // "Are they around" becomes "should this login still exist".
    expect(lastSeen("2026-06-01T10:00:00+05:30", now)).toBe(
      "Not seen in over a month",
    );
  });

  it("says nothing when there is nothing to say", () => {
    expect(lastSeen(undefined, now)).toBeNull();
    expect(lastSeen("not a date", now)).toBeNull();
  });

  it("never shows a future timestamp as a negative count", () => {
    // Clock skew between the API and this render is a real thing, and
    // "Last seen -1 days ago" is how an operator learns to distrust a screen.
    expect(lastSeen("2026-09-02T10:00:00+05:30", now)).toBe("Last seen today");
  });
});
