import { describe, it, expect } from "vitest";
import {
  activeSeniorCount,
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

  it("does not count an unaccepted invitation", () => {
    // An invitation has no login, so it cannot let anybody back in and cannot
    // be the reason removing the real one is safe.
    const team = [
      person({ id: "usr_a", roles: ["OWNER"] }),
      person({ id: "inv_b", roles: ["OWNER"], pending: true }),
    ];
    expect(activeSeniorCount(team)).toBe(1);
  });

  it("counts ADMINS as well as owners", () => {
    /*
      The rule is "the last active OWNER or ADMIN", not the last owner
      (yuvoy-operator#51 item 4). Counting owners alone was wrong twice over: it
      blocked holding an owner while an active admin remained, and it allowed
      removing the last admin at a business whose owner had gone.
    */
    const team = [
      person({ id: "usr_owner", roles: ["OWNER"] }),
      person({ id: "usr_admin", roles: ["ADMIN"] }),
      person({ id: "usr_mgr", roles: ["MANAGER"] }),
      person({ id: "usr_staff", roles: ["STAFF"] }),
    ];
    expect(activeSeniorCount(team)).toBe(2);
  });

  it("does not count a HELD login", () => {
    /*
      A suspended login cannot let anybody in either, so it cannot be the one
      that makes removing the other safe. This is the case that would otherwise
      let two people lock each other out one after the other.
    */
    const team = [
      person({ id: "usr_owner", roles: ["OWNER"] }),
      person({ id: "usr_admin", roles: ["ADMIN"], state: "suspended" }),
    ];
    expect(activeSeniorCount(team)).toBe(1);
  });

  it("counts somebody holding both roles once", () => {
    const team = [person({ id: "usr_both", roles: ["OWNER", "ADMIN"] })];
    expect(activeSeniorCount(team)).toBe(1);
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

  it("refuses to remove the last owner OR admin, and that one DOES say why", () => {
    /*
      The one reason that survives the cut. Somebody would read a missing Remove
      here as a bug, and it is not inferable from the row.

      It now says why rather than only what, because there IS a next step since
      14 September: an owner can be invited from this portal, so "somebody has
      to be able to let people in" tells a reader what to do about it.

      The contract's own reasoning, on this endpoint: "a business with neither
      has nobody who can let anybody back in."
    */
    const expected =
      "The last owner or admin. Somebody has to be able to let people in.";

    const lastOwner = [person({ id: "usr_owner", roles: OWNER })];
    const r = removability(lastOwner[0], me, OWNER, lastOwner);
    expect(r.removable).toBe(false);
    expect(r.reason).toBe(expected);

    // The same refusal on the last ADMIN, which the owners-only rule allowed.
    const lastAdmin = [person({ id: "usr_admin", roles: ADMIN })];
    expect(removability(lastAdmin[0], me, OWNER, lastAdmin).reason).toBe(
      expected,
    );
  });

  it("allows removing an owner while an ACTIVE admin remains", () => {
    // An admin can let people back in, so the business is not locked out.
    const team = [
      person({ id: "usr_owner", roles: OWNER }),
      person({ id: "usr_admin", roles: ADMIN }),
    ];
    expect(removability(team[0], me, OWNER, team).removable).toBe(true);
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

  it("does not let an ADMIN remove an owner", () => {
    // The whole of this endpoint's seniority clause: "an ADMIN cannot remove an
    // OWNER". Nothing about another admin (yuvoy-operator#51 item 4).
    const team = [
      person({ id: me, roles: ADMIN }),
      person({ id: "usr_owner", roles: OWNER }),
    ];
    expect(removability(team[1], me, ADMIN, team).removable).toBe(false);
  });

  it("lets an ADMIN remove ANOTHER ADMIN, which it used to refuse", () => {
    /*
      The narrowing that matters, and it widens what one login can do to
      another. This test asserted the opposite until 14 September, on the 403 as
      it was then worded: "an ADMIN cannot change an OWNER or another ADMIN".
      Each endpoint now names only the OWNER clause.

      An owner appointing two admins should know they can remove each other. The
      `409` on the last active owner or admin is what stops it being a lockout,
      and the case below proves that still bites.
    */
    const team = [
      person({ id: me, roles: ADMIN }),
      person({ id: "usr_admin2", roles: ADMIN }),
      person({ id: "usr_owner", roles: OWNER }),
    ];
    expect(removability(team[1], me, ADMIN, team).removable).toBe(true);
  });

  it("does NOT withhold Remove on a held admin just because they hold the role", () => {
    /*
      The over-refusal the "is the last one" phrasing caused, and it is reachable
      at Reef Divers: one active owner, one admin somebody has paused. The count
      of active seniors is 1 and the paused admin holds a senior role, so the old
      check refused to remove them and said "the last owner or admin" — which is
      false. They are not active, the server does not count them, and removing
      them takes nothing away from the business.
    */
    const team = [
      person({ id: me, roles: OWNER }),
      person({ id: "usr_admin", roles: ADMIN, state: "suspended" }),
    ];
    const verdict = removability(team[1], me, OWNER, team);
    expect(verdict.removable).toBe(true);
    expect(verdict.reason).toBeUndefined();
  });

  it("refuses when the removal itself would leave nobody in charge", () => {
    /*
      Stated as arithmetic about what is LEFT, which is the server's own rule:
      "nobody can remove the last active OWNER or ADMIN: a business with neither
      has nobody who can let anybody back in."

      Reached here with a signed-in id that matches no row — a list one render
      behind the account. That is the only way it can happen in the product, and
      it is exactly why the check is worth keeping: rank cannot express it.
    */
    const team = [person({ id: "usr_owner", roles: OWNER })];
    const verdict = removability(team[0], "usr_gone", OWNER, team);
    expect(verdict.removable).toBe(false);
    expect(verdict.reason).toContain("last owner or admin");
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
