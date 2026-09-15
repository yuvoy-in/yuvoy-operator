/**
 * The four roles, and what each of them may actually do.
 *
 * Every claim on this screen is a promise about access, so every claim here is
 * taken from `contracts/operator-openapi.yaml` rather than from the design.
 * An owner who reads "staff can only see the manifest" and hands a phone to a
 * skipper on that basis is relying on this file being true:
 *
 *   - `GET /me` · `canManage` — "OWNER, **ADMIN** or MANAGER. Capacity, closed
 *     dates, earnings and listing edits require it."
 *   - `POST /requests/{id}/accept` — 403 "STAFF cannot commit seats."
 *   - `POST /requests/{id}/decline` — 403 "STAFF cannot answer requests."
 *   - `POST /slots/{id}/call-off` — "Requires OWNER, **ADMIN** or MANAGER."
 *   - `POST /change-requests/bank` — "Three gates, not one: OWNER only …"
 *   - `POST /team`, `PUT /team/{id}/role`, `POST /team/{id}/hold`,
 *     `.../restore` and `DELETE /team/{id}` — "OWNER or ADMIN only, and an
 *     ADMIN cannot change an OWNER or another ADMIN."
 *
 * Note what is NOT claimed: media and reels carry a generic `Forbidden` with
 * no role named, so this file says nothing about them. A role description is
 * only worth having if an operator can act on it.
 */

export const OPERATOR_ROLES = ["OWNER", "ADMIN", "MANAGER", "STAFF"] as const;
export type OperatorRole = (typeof OPERATOR_ROLES)[number];

/**
 * What may be invited, and it is now TWO roles rather than three.
 *
 * ## The reversal, 14 September 2026
 *
 * This list used to be `["ADMIN", "MANAGER", "STAFF"]`, on the contract's own
 * reasoning that "OWNER cannot be invited, because the owner is the person
 * whose bank account this is, and that is not a thing one login should be able
 * to hand to a phone number."
 *
 * That has changed on both ends (D15, yuvoy-operator#51). `POST /team` now
 * says "**Everybody joins as `STAFF`, except an owner**": an invitation makes
 * somebody staff or an owner, and nothing in between. ADMIN and MANAGER are
 * reached by CHANGING a role after they have joined, not by inviting into one.
 *
 * So the two lists have diverged rather than one being a subset of the other:
 * `ASSIGNABLE_ROLES` in `access.ts` is all four, and this is two. Asking for
 * MANAGER or ADMIN is not refused — it is downgraded to STAFF and answered with
 * a `note` — so offering either would be a form that quietly does something else.
 *
 * STAFF is first because it is the preselected answer and the safer one. The
 * form checks it BY NAME rather than by position, so reordering this cannot
 * preselect Owner by accident.
 */
export const INVITABLE_ROLES = ["STAFF", "OWNER"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export function isInvitableRole(v: string): v is InvitableRole {
  return (INVITABLE_ROLES as readonly string[]).includes(v);
}

/**
 * Strength order — and the roles nest again.
 *
 * `roles` is plural on `TeamMember`, so a member may hold two, and the order
 * decides which single description is shown.
 *
 * ## The correction, 6 September 2026
 *
 * This file used to say "**ADMIN does not nest with MANAGER**", on the grounds
 * that `canManage` then excluded ADMIN. That
 * was true when it was written and **is no longer**: `canManage` is now
 * "OWNER, ADMIN or MANAGER", and the contract gives the reason — "ADMIN holds
 * it because the role exists for an owner who is off the island: one who could
 * add a manager but not close a date would be a stand-in for nothing."
 *
 * So ADMIN now strictly contains MANAGER: everything a manager may do, plus
 * this list. The order below is a real superset chain again — OWNER ⊃ ADMIN ⊃
 * MANAGER ⊃ STAFF — and collapsing to the strongest loses nothing. Every role
 * held is still shown as its own chip.
 *
 * The question raised on yuvoy-operator#23 — whether an admin really could not
 * set seats — is answered, and the answer was no.
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
          This was WRONG until 6 September, and wrong in the worst direction.

          It read: "Sees this list and can add people to it", and cannot
          "remove anybody … change seats or see earnings." Every one of those
          exclusions except the payout one has since become false — `canManage`
          gained ADMIN, and `DELETE /team/{id}` widened to OWNER or ADMIN
          (yuvoy-api#109).

          An owner handing somebody an admin role on the strength of "cannot
          see earnings" was being told something untrue about who can read
          their margins. Caught by `pnpm qa`'s contract parse changing buckets
          under the re-pin, not by anybody reading this.
        */
        can: "Everything a manager can, plus this list: the stand-in for an owner who is off the island.",
        /*
          What actually remains OWNER-only: the bank change ("Three gates, not
          one: OWNER only"), and acting on an owner or another admin, which is
          the 403 all four access endpoints carry.
        */
        /*
          Narrowed on 14 September (yuvoy-operator#51). It read "cannot change
          the owner or another admin", which was the contract's rule until the
          access endpoints were restated: each now says only that "an ADMIN
          cannot change an OWNER". An admin may act on another admin.

          Worth being exact about, because an owner appointing an admin reads
          this to decide whether two admins can lock each other out. They can.
        */
        cannot: "Cannot change payout details, and cannot change the owner.",
      };
    case "MANAGER":
      return {
        label: "Manager",
        can: "Seats, closed dates, seat requests, calling off a departure, earnings and listing edits.",
        cannot:
          "Cannot change payout details, and cannot add, remove or pause people.",
      };
    case "STAFF":
      return {
        label: "Staff",
        can: "Today's manifest: marks people off as they arrive.",
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
