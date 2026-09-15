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
  /** `••••0132`. The API's mask, passed through only if it is one — see `maskedOnly`. */
  phoneMasked?: string;
}

/**
 * Four digits, or nothing.
 *
 * The API masks in SQL and returns `••••0132` (yuvoy-api#62). If a future
 * contract — or a mock — ever put more of the number here, rendering it would
 * turn this screen into the directory of an operator's staff that the mask
 * exists to prevent. So anything with more than four digits is treated as not
 * a mask, and the row shows nothing rather than a number.
 */
function maskedOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const digits = value.replace(/\D/g, "");
  return digits.length > 0 && digits.length <= 4 ? value : undefined;
}

/** Whatever `GET /team` returned, narrowed without inventing anything. */
export function toTeamPerson(raw: {
  id?: string;
  name?: string;
  roles?: string[];
  state?: string;
  pending?: boolean;
  lastSeenAt?: string;
  phoneMasked?: string;
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
    phoneMasked: maskedOnly(raw.phoneMasked),
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

/**
 * Active people who can administer the business: owners AND admins together.
 *
 * ## Why it is not owners alone
 *
 * It was, and that was wrong in the direction that matters. The contract's
 * refusal is "the last active **OWNER or ADMIN**", with the reason spelled out
 * on `DELETE /team/{id}`: "a business with neither has nobody who can let
 * anybody back in."
 *
 * Counting owners alone therefore refused too much and allowed too much at the
 * same time. It blocked holding an owner while an active admin could still
 * administer the business, and it allowed removing the last ADMIN at a business
 * with no owner, which is the lockout the rule exists to prevent
 * (yuvoy-operator#51 item 4).
 *
 * A PENDING row is an invitation, not a login, so it cannot let anybody in and
 * is not counted. A HELD login cannot either, which is why the name says
 * active: `isHeld` lives in `access.ts` and the state value is checked here
 * rather than imported, to keep this module free of that dependency.
 */
export function activeSeniorCount(team: readonly TeamPerson[]): number {
  return team.filter(
    (m) =>
      !m.pending &&
      m.state !== "suspended" &&
      (m.roles.includes("OWNER") || m.roles.includes("ADMIN")),
  ).length;
}

/**
 * Whether this person IS the last active owner or admin — the refusal
 * `DELETE /team/{id}` and `POST /team/{id}/hold` share, in the server's words:
 * "nobody can remove the last active OWNER or ADMIN: a business with neither has
 * nobody who can let anybody back in."
 *
 * ## Two clauses, and each one fixes a different mistake
 *
 * It used to read `member is senior && activeSeniorCount(team) <= 1`, which
 * over-refused. A business with one active owner and one HELD admin has a count
 * of 1, and the held admin holds a senior role, so Remove was withheld from
 * their row with "the last owner or admin" — false. They are not active, the
 * server does not count them, and removing them takes nothing away. Reef Divers
 * hits it the moment somebody pauses Nisha. So the first clause asks whether the
 * member is an ACTIVE senior, not whether they hold the role.
 *
 * And it asks what the count is AFTERWARDS rather than what it is now, because
 * "the last one" is a claim about what the change leaves behind. One active
 * senior with a second row that is pending, held or junior reads the same either
 * way; a list that is one render behind does not.
 *
 * Note this cannot fire for a row other than your own in normal use: whoever
 * reaches these controls is themselves an active OWNER or ADMIN, so the count
 * after the change includes them. Their own row is refused before this. It is
 * kept because it is the rule, it is cheap, and it still bites when `me` and the
 * list disagree — and because the server stays the authority regardless: every
 * action renders the `409`.
 */
export function isLastActiveSenior(
  team: readonly TeamPerson[],
  member: TeamPerson,
): boolean {
  const senior =
    member.roles.includes("OWNER") || member.roles.includes("ADMIN");
  if (!senior || member.pending || member.state === "suspended") return false;
  return activeSeniorCount(team.filter((m) => m.id !== member.id)) === 0;
}

export interface Removability {
  removable: boolean;
  /** Why not, said beside the row rather than after a tap that 409s. */
  reason?: string;
}

/**
 * Whether this row may be removed, decided the way the server decides it.
 *
 * `DELETE /team/{id}` answers **`409 cannot_change_access`**: "yourself, or the
 * last active OWNER or ADMIN". `cannot_remove` is gone from the contract and is
 * never sent (yuvoy-operator#51 item 4), so nothing branches on it any more.
 *
 * Both refusals are knowable from what is already on screen. The precedent is
 * the capacity ceiling in O9: **disable the control and say why, rather than
 * explain a 409 afterwards.** The action still handles the 409, because roles
 * can change between this render and the tap.
 */
export function removability(
  member: TeamPerson,
  meId: string,
  myRoles: readonly string[],
  team: readonly TeamPerson[],
): Removability {
  // OWNER or ADMIN, widened from OWNER-only (yuvoy-api#109) — and an admin
  // may not remove an owner or another admin, the same 403 the other three
  // access endpoints carry. No reason on either: not offering the control is
  // the answer, and your own row has your name on it (yuvoy-operator#25 §4).
  if (!myRoles.includes("OWNER") && !myRoles.includes("ADMIN")) {
    return { removable: false };
  }
  if (!member.pending && member.id === meId) return { removable: false };
  /*
    NARROWED on 14 September. It read "an admin may not remove an owner or
    another admin", which was this endpoint's 403 until it was restated: it now
    says only "an ADMIN cannot remove an OWNER" (yuvoy-operator#51 item 4).

    So two admins may remove each other, and the thing that stops that becoming
    a lockout is the `409` below rather than rank. Same narrowing as
    `seniorityAllows` in `access.ts`, and it has to happen in both or the Remove
    button and the Change role button disagree on the same row.
  */
  if (!myRoles.includes("OWNER") && member.roles.includes("OWNER")) {
    return { removable: false };
  }

  /*
    The one refusal that survives the copy cut. An owner would otherwise read a
    missing Remove on the last senior row as a bug, and it is not inferable from
    the row itself.
  */
  /*
    The last person who can administer the business, counting owners AND admins
    together (yuvoy-operator#51 item 4). The contract's reason on this very
    endpoint: "a business with neither has nobody who can let anybody back in."

    Applies to an ADMIN as well as an OWNER, which the owners-only version
    missed: removing the last admin at a business whose owner has left is the
    same lockout by a different door.
  */
  if (!member.pending && isLastActiveSenior(team, member)) {
    return {
      removable: false,
      reason:
        "The last owner or admin. Somebody has to be able to let people in.",
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
