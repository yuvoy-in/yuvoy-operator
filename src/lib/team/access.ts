import { isLastActiveSenior, type TeamPerson } from "./members";

/**
 * Who may do what to whom on the Team screen — yuvoy-operator#25.
 *
 * ## Every rule here is quoted from the contract, not designed
 *
 * `PUT /team/{id}/role`, `POST /team/{id}/hold`, `POST /team/{id}/restore` and
 * `DELETE /team/{id}` each state their own refusals, and this file is the one
 * place they are written down:
 *
 *   - **403** on all four: "OWNER or ADMIN only", plus one clause each — "an
 *     ADMIN cannot change an OWNER's role", "cannot hold an OWNER", "cannot
 *     restore an OWNER", "cannot remove an OWNER". An admin may act on another
 *     admin; see `seniorityAllows`.
 *   - **409 `cannot_change_access`**, on all four: "your own access, or the last
 *     active OWNER or ADMIN". Remove answers this too — `cannot_remove` is gone
 *     from the contract and is never sent (yuvoy-operator#51 item 4).
 *   - Role: `enum: [OWNER, ADMIN, MANAGER, STAFF]`. An OWNER or an ADMIN may
 *     make somebody already on the team an owner (D31), rather than removing
 *     them and inviting them back.
 *
 * ## Why the client decides this at all
 *
 * The rule for this portal is to render what the API allows rather than reach
 * a second opinion — `joinUrl` is the model, present only for a caller who can
 * invite, so presence IS the answer and no role is inspected.
 *
 * There is no equivalent signal per row: `TeamMember` carries no capability
 * field, so a screen that offered every action to everybody would answer half
 * of them with a 403 after the tap. The precedent for that is O9's capacity
 * ceiling — **disable the control and say why, rather than explain a refusal
 * afterwards** — so this derives, and derives from the contract's own stated
 * conditions rather than from an idea about seniority.
 *
 * **Every action still handles every refusal.** This is a render-time opinion
 * about a list that another owner may be editing on another phone; the server
 * remains the authority and the actions say so when it disagrees.
 */

/**
 * The value `state` takes when somebody is held.
 *
 * `TeamMember.state` is a bare string in the contract with **no enum**, and
 * this is the single value this portal interprets. Everything else is still
 * shown rather than read (see `member-row.tsx`).
 *
 * The degradation is deliberate and safe in one direction: if the server ever
 * spells a hold differently, the row reads as working and offers **Hold**,
 * which the API answers `404 not currently working`. The action says so. The
 * opposite mistake — reading a working member as held and offering Restore —
 * would tell an owner somebody has no access when they do, and that is the
 * direction this screen must never be wrong in.
 */
export const HELD_STATE = "suspended";

export function isHeld(member: TeamPerson): boolean {
  return member.state === HELD_STATE;
}

/**
 * Roles that may be set here — now all FOUR.
 *
 * OWNER used to be excluded, on the contract's reasoning that "the owner is
 * whoever the payout account belongs to; that moves deliberately, not from a
 * login." `PUT /team/{id}/role` now declares `enum: [OWNER, ADMIN, MANAGER,
 * STAFF]` and refuses only "an ADMIN cannot change an OWNER's role", so an
 * OWNER may hand the role on (yuvoy-operator#51 item 3).
 *
 * The weight of that has not gone anywhere, which is why the confirmation says
 * what it does: a new owner "will be able to change where the business is
 * paid." An admin doing it is told they cannot undo it.
 */
export const ASSIGNABLE_ROLES = ["OWNER", "ADMIN", "MANAGER", "STAFF"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(v: string): v is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(v);
}

export interface Allowed {
  allowed: boolean;
  /**
   * Why not — and MOST refusals do not get one.
   *
   * yuvoy-operator#25 §4: "a sentence justifying the absence is the screen
   * arguing with the reader". Not offering an action already says it is not
   * available, so a reason is written only where it changes what somebody
   * does next. Your own row needs none — it has your name on it. An admin
   * looking at the owner's row needs none — the absence is the answer.
   *
   * "The last owner or admin" survives that test, barely: it is the one refusal
   * an owner would otherwise read as a bug, and it is not inferable from the row
   * itself. It is stated as a fact and nothing more.
   */
  reason?: string;
}

const NO: Allowed = { allowed: false };
const YES: Allowed = { allowed: true };

/**
 * What this signed-in person may do at all.
 *
 * "OWNER or ADMIN only" on every one of the four endpoints. A MANAGER has
 * `canManage` — capacity, closed dates, earnings — and none of this, which is
 * exactly why `canManage` is not the gate anywhere in this file.
 */
export function canManageAccess(myRoles: readonly string[]): boolean {
  return myRoles.includes("OWNER") || myRoles.includes("ADMIN");
}

/**
 * The 403 rule, shared by all four endpoints — and NARROWER than it was.
 *
 * It used to read "an ADMIN cannot change an OWNER **or another ADMIN**", which
 * was the contract's wording at the time. Each of the four endpoints now says
 * only that an ADMIN cannot act on an OWNER:
 *
 *   - role: "an ADMIN cannot change an OWNER's role"
 *   - hold: "an ADMIN cannot hold an OWNER"
 *   - restore: "an ADMIN cannot restore an OWNER"
 *   - remove: "an ADMIN cannot remove an OWNER"
 *
 * So two admins may act on each other. That is a real widening of what one
 * login can do to another, and it is the API's decision rather than this
 * screen's: an admin exists to stand in for an owner who is off the island, and
 * one who could not remove a colleague's access would be a stand-in for
 * nothing. The `409` on the last active owner or admin is what stops it
 * becoming a lockout.
 *
 * An OWNER may act on anybody, subject to the 409s below, which are about the
 * account rather than about rank.
 */
function seniorityAllows(
  myRoles: readonly string[],
  member: TeamPerson,
): Allowed {
  if (!canManageAccess(myRoles)) return NO;
  if (myRoles.includes("OWNER")) return YES;

  // An admin, then. No reason: the absence of the control is the answer, and
  // a line explaining the hierarchy is the screen arguing with the reader.
  if (member.roles.includes("OWNER")) return NO;
  return YES;
}

/**
 * Whether somebody's role may be changed.
 *
 * An owner's role is not changed from a login at all: "the owner is whoever
 * the payout account belongs to; that moves deliberately". A pending row is an
 * invitation rather than a user — re-inviting replaces it, so the role is
 * changed by inviting again, and this offers nothing.
 */
export function canChangeRole(
  member: TeamPerson,
  meId: string,
  myRoles: readonly string[],
): Allowed {
  if (member.pending) return NO;
  if (member.id === meId) return NO;
  /*
    An owner's row used to refuse everybody. It now refuses only an ADMIN, which
    `seniorityAllows` already decides: `PUT /team/{id}/role` takes OWNER in its
    enum and refuses only "an ADMIN cannot change an OWNER's role"
    (yuvoy-operator#51 item 3).
  */
  return seniorityAllows(myRoles, member);
}

/**
 * Whether somebody's login may be paused.
 *
 * A hold "keeps the person, the role and the history" and only stops the
 * login, so the two refusals that matter are the account-level ones: your own
 * access, and the last owner.
 */
export function canHold(
  member: TeamPerson,
  meId: string,
  myRoles: readonly string[],
  team: readonly TeamPerson[],
): Allowed {
  // An invitation has no login to pause. Revoking it is the verb.
  if (member.pending) return NO;
  if (isHeld(member)) return NO;
  // Your own row. It has your name on it; nothing needs saying.
  if (member.id === meId) return NO;
  /*
    Owners AND admins, counted together, and asked as "what is left afterwards".
    `cannot_change_access` here is "your own access, or the last active OWNER or
    ADMIN" — the owners-only version both refused too much and allowed too much:
    it blocked holding an owner while an active admin remained, and allowed
    holding the last admin at a business with no owner. See
    `isLastActiveSenior` for why "active" and "afterwards" both matter.
  */
  if (isLastActiveSenior(team, member)) {
    return {
      allowed: false,
      reason:
        "The last owner or admin. Somebody has to be able to let people in.",
    };
  }
  return seniorityAllows(myRoles, member);
}

/** Whether a held login may be given back. Same 403 rule, no 409 of its own. */
export function canRestore(
  member: TeamPerson,
  meId: string,
  myRoles: readonly string[],
): Allowed {
  if (member.pending) return NO;
  if (!isHeld(member)) return NO;
  if (member.id === meId) return NO;
  return seniorityAllows(myRoles, member);
}
