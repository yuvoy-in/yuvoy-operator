/**
 * The four roles, and what each of them may actually do.
 *
 * Every claim on this screen is a promise about access, so every claim here is
 * taken from `contracts/operator-openapi.yaml` rather than from the design.
 * An owner who reads "staff can only see the manifest" and hands a phone to a
 * skipper on that basis is relying on this file being true:
 *
 *   - `GET /me` · `canManage` — "OWNER or MANAGER. Capacity, closed dates,
 *     earnings and listing edits require it."
 *   - `POST /requests/{id}/accept` — 403 "STAFF cannot commit seats."
 *   - `POST /requests/{id}/decline` — 403 "STAFF cannot answer requests."
 *   - `POST /slots/{id}/call-off` — "Requires OWNER or MANAGER."
 *   - `POST /change-requests/bank` — "Three gates, not one: OWNER only …"
 *   - `POST /team` — "OWNER or ADMIN." `DELETE /team/{id}` — 403 "OWNER only."
 *
 * Note what is NOT claimed: media and reels carry a generic `Forbidden` with
 * no role named, so this file says nothing about them. A role description is
 * only worth having if an operator can act on it.
 */

export const OPERATOR_ROLES = ["OWNER", "ADMIN", "MANAGER", "STAFF"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/**
 * What may be invited — **not** the same list.
 *
 * "OWNER cannot be invited, because the owner is the person whose bank
 * account this is, and that is not a thing one login should be able to hand
 * to a phone number." The first owner is created by Yuvoy.
 */
export const INVITABLE_ROLES = ["ADMIN", "MANAGER", "STAFF"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(v: string): v is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(v);
}

/**
 * Strength order — and ADMIN broke the reason there was one.
 *
 * `roles` is plural on `TeamMember`, so a member may hold two. The roles used
 * to nest: `canManage` is "OWNER or MANAGER" and everything STAFF may do a
 * MANAGER may also do, so the strongest role described the whole of somebody's
 * access and collapsing to it lost nothing.
 *
 * **ADMIN does not nest with MANAGER.** An ADMIN may invite people and a
 * MANAGER may not; a MANAGER has `canManage` — capacity, closed dates,
 * earnings — and an ADMIN does not, because `GET /me` still defines that as
 * "OWNER or MANAGER". Neither contains the other.
 *
 * So the order below is about seniority, not capability, and it is only safe
 * because of what it is used for: picking ONE description to show. Anyone
 * holding both roles is described by the ADMIN entry, which names both what it
 * adds and what it does not carry, rather than quietly implying a superset.
 * Every role held is still shown as its own chip.
 *
 * (That an ADMIN cannot set seats is surprising enough to be worth checking —
 * raised on yuvoy-operator#23. Rendered as the contract states it either way:
 * inventing a capability is the one direction this screen must never be wrong
 * in.)
 */
export function roleRank(role: string): number {
  switch (role) {
    case "OWNER":
      return 4;
    case "ADMIN":
      return 3;
    case "MANAGER":
      return 2;
    case "STAFF":
      return 1;
    default:
      // A role this build does not know about. Ranked below everything so it
      // never silently becomes the one a description is derived from.
      return 0;
  }
}

/** The strongest role held, or `null` if none of them is one we know. */
export function strongestRole(roles: readonly string[]): OperatorRole | null {
  const known = roles.filter((r): r is OperatorRole => roleRank(r) > 0);
  if (known.length === 0) return null;
  return known.reduce((a, b) => (roleRank(b) > roleRank(a) ? b : a));
}

export interface RoleDescription {
  /** What the operator reads. `STAFF` is not a word anybody says out loud. */
  label: string;
  /** What this role can do, in the operator's terms. */
  can: string;
  /** What it deliberately cannot. Absent for OWNER, which has no ceiling. */
  cannot?: string;
}

export function describeRole(role: string): RoleDescription | null {
  switch (role) {
    case "OWNER":
      return {
        label: "Owner",
        can: "Everything, including where the money goes and who is on this list.",
      };
    case "ADMIN":
      return {
        label: "Admin",
        /*
          Exactly the two things the contract grants: `GET /team` is "OWNER or
          ADMIN only" and `POST /team` is "OWNER or ADMIN". Nothing else names
          ADMIN anywhere in the document.
        */
        can: "Sees this list and can add people to it — the stand-in for an owner who is off the island.",
        /*
          `DELETE /team/{id}` is 403 "OWNER only", the bank change is OWNER
          only, and `canManage` is still "OWNER or MANAGER" — so an admin has
          less day-to-day power than a manager, which is worth saying out loud
          rather than leaving somebody to discover.
        */
        cannot:
          "Cannot remove anybody, cannot change payout details, and cannot change seats or see earnings.",
      };
    case "MANAGER":
      return {
        label: "Manager",
        can: "Seats, closed dates, seat requests, calling off a departure, earnings and listing edits.",
        cannot:
          "Cannot change payout details, and cannot add or remove people.",
      };
    case "STAFF":
      return {
        label: "Staff",
        can: "Today's manifest — marks people off as they arrive.",
        cannot:
          "Sees seat requests but cannot answer them, and cannot see earnings.",
      };
    default:
      /*
        An unrecognised role is rendered as itself with no claim attached. The
        alternative — falling back to the weakest description — would tell an
        owner that somebody has less access than they do, which is the one
        direction this screen must never be wrong in.
      */
      return null;
  }
}

/** The label alone, falling back to the raw value for a role we do not know. */
export function roleLabel(role: string): string {
  return describeRole(role)?.label ?? role;
}
