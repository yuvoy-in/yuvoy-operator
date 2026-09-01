import { marketDate } from "@/lib/format/market-time";
import { roleRank, strongestRole } from "./roles";

/**
 * The team, as two lists rather than one.
 *
 * `GET /team` returns "active people and unaccepted invitations, in one list",
 * and the trap is in the contract's own words: on a pending row **`id` is the
 * invitation, not a user**. So a pending row is not a person who has less
 * access — it is a code sitting on somebody's phone that nobody has used. It
 * has no `lastSeenAt` worth reading, removing it revokes an invitation rather
 * than ending anybody's access, and re-inviting the same number replaces it.
 *
 * Rendering both in one list makes all of that a footnote. They are split here
 * instead, so the screen can say two different things.
 */

export interface TeamPerson {
  id: string;
  name: string;
  roles: string[];
  /** Free text in the contract — no enum — so it is passed through, never branched on. */
  state?: string;
  pending: boolean;
  lastSeenAt?: string;
}

/** Whatever `GET /team` returned, narrowed without inventing anything. */
export function toTeamPerson(raw: {
  id?: string;
  name?: string;
  roles?: string[];
  state?: string;
  pending?: boolean;
  lastSeenAt?: string;
}): TeamPerson {
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    roles: raw.roles ?? [],
    state: raw.state,
    /*
      `pending` absent is not `true`. An invitation is the exceptional row and
      the API marks it; treating an unmarked row as pending would show an
      active manager as somebody who has never signed in.
    */
    pending: raw.pending === true,
    lastSeenAt: raw.lastSeenAt,
  };
}

/** Strongest role first, then by name, so the owner is always at the top. */
function byStanding(a: TeamPerson, b: TeamPerson): number {
  const rank =
    roleRank(strongestRole(b.roles) ?? "") -
    roleRank(strongestRole(a.roles) ?? "");
  return rank !== 0 ? rank : a.name.localeCompare(b.name);
}

export interface SplitTeam {
  people: TeamPerson[];
  invitations: TeamPerson[];
}

export function splitTeam(team: readonly TeamPerson[]): SplitTeam {
  return {
    people: team.filter((m) => !m.pending).sort(byStanding),
    invitations: team.filter((m) => m.pending).sort(byStanding),
  };
}

/** Active owners only. An unaccepted invitation cannot approve a bank change. */
export function activeOwnerCount(team: readonly TeamPerson[]): number {
  return team.filter((m) => !m.pending && m.roles.includes("OWNER")).length;
}

export interface Removability {
  removable: boolean;
  /** Why not, said beside the row rather than after a tap that 409s. */
  reason?: string;
}

/**
 * Whether this row may be removed, decided the way the server decides it.
 *
 * `409 cannot_remove` is "yourself, or the last owner", and both refusals are
 * knowable from what is already on screen. The precedent is the capacity
 * ceiling in O9: **disable the control and say why, rather than explain a 409
 * afterwards.** The action still handles `cannot_remove`, because roles can
 * change between this render and the tap.
 */
export function removability(
  member: TeamPerson,
  meId: string,
  team: readonly TeamPerson[],
): Removability {
  if (!member.pending && member.id === meId) {
    return {
      removable: false,
      reason: "This is you. Another owner has to remove you.",
    };
  }

  if (
    !member.pending &&
    member.roles.includes("OWNER") &&
    activeOwnerCount(team) <= 1
  ) {
    return {
      removable: false,
      reason:
        "The only owner. An account with no owner cannot approve a bank change, receive a step-up code, or invite anybody.",
    };
  }

  return { removable: true };
}

/**
 * "Last seen" in days, not in a timestamp.
 *
 * An owner scanning this list is looking for a login nobody uses — a phone
 * that left with somebody last season and still works. "4 days ago" answers
 * that; "25 August at 14:02" makes them count on their fingers at 6am.
 *
 * Days are counted in the MARKET's zone, not the device's, for the same reason
 * every other time in this portal is: the operator's day is Havelock's day.
 * `now` is passed in because `Date.now()` during render is impure and the
 * React compiler refuses it — the same rule `hasDeparted` follows.
 */
export function lastSeen(iso: string | undefined, now: number): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;

  const days =
    (Date.parse(`${marketDate(new Date(now))}T00:00:00+05:30`) -
      Date.parse(`${marketDate(new Date(then))}T00:00:00+05:30`)) /
    86_400_000;

  if (days <= 0) return "Last seen today";
  if (days === 1) return "Last seen yesterday";
  if (days < 30) return `Last seen ${days} days ago`;
  /*
    Past a month the exact number stops meaning anything and the shape of the
    question changes from "are they around" to "should this login still exist".
    Said in those words rather than as a bigger number.
  */
  return "Not seen in over a month";
}
