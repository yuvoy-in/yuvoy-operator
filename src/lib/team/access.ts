import { activeOwnerCount, type TeamPerson } from "./members";

/**
 * Who may do what to whom on the Team screen — yuvoy-operator#25.
 *
 * ## Every rule here is quoted from the contract, not designed
 *
 * `PUT /team/{id}/role`, `POST /team/{id}/hold`, `POST /team/{id}/restore` and
 * `DELETE /team/{id}` each state their own refusals, and this file is the one
 * place they are written down:
 *
 *   - **403** on all four: "OWNER or ADMIN only, and an ADMIN cannot change an
 *     OWNER or another ADMIN."
 *   - **409 `cannot_change_access`** — "including changing your own", and on
 *     hold, "your own access, or the last owner".
 *   - **409 `cannot_remove`** — "yourself, or the last owner".
 *   - Role: "`OWNER` cannot be given and an owner's role cannot be changed
 *     here. The owner is whoever the payout account belongs to; that moves
 *     deliberately, not from a login."
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

/** Roles that may be set here. OWNER is not one of them, deliberately. */
export const ASSIGNABLE_ROLES = ["ADMIN", "MANAGER", "STAFF"] as const;
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
   * "The only owner" survives that test, barely: it is the one refusal an
   * owner would otherwise read as a bug, and it is not inferable from the row
   * itself. It is stated as a fact and nothing more, because there is no next
   * step to offer — an owner cannot be invited from this portal.
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
 * The 403 rule, shared by all four endpoints.
 *
 * An ADMIN may not act on an OWNER or on another ADMIN. An OWNER may act on
 * anybody — subject to the 409s below, which are about the account rather than
 * about rank.
 */
function seniorityAllows(
  myRoles: readonly string[],
  member: TeamPerson,
): Allowed {
  if (!canManageAccess(myRoles)) return NO;
  if (myRoles.includes("OWNER")) return YES;

  // An admin, then. No reason: the absence of the control is the answer, and
  // a line explaining the hierarchy is the screen arguing with the reader.
  if (member.roles.includes("OWNER") || member.roles.includes("ADMIN")) {
    return NO;
  }
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
  // No reason. An owner's role not being editable from a login is a rule the
  // absent control states perfectly well on its own.
  if (member.roles.includes("OWNER")) return NO;
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
  if (member.roles.includes("OWNER") && activeOwnerCount(team) <= 1) {
    return { allowed: false, reason: "The only owner." };
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
