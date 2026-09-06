import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import { toTeamPerson, type TeamPerson } from "./members";

/**
 * The team, read on the server.
 *
 * Deliberately **not** soft-failing the way `getChangeRequests` does. That one
 * degrades to an absent warning on a page about money; this one IS the page,
 * and a team screen that renders an empty list because a fetch failed would
 * tell an owner that nobody has access to their business. The error goes to
 * the boundary, which says something true.
 *
 * `GET /team` carries no role gate — every role may read it, and it answers
 * only 401. The WRITES are gated and no longer identically: `POST /team` is
 * "OWNER or ADMIN" and `DELETE /team/{id}` is still 403 "OWNER only". The
 * screen says both up front rather than after a tap.
 */
export interface Team {
  people: TeamPerson[];
  /**
   * The business's join link, or absent.
   *
   * "Present only for a caller who can invite" — so its presence is the
   * SERVER's own answer to that question, and the screen renders it on that
   * basis rather than deriving a second opinion from roles. That second
   * opinion is precisely what drifted when ADMIN was added: the portal went on
   * gating on OWNER while the backend had started accepting ADMIN too.
   */
  joinUrl?: string;
  /** Whatever the API wants said alongside the link. Rendered verbatim. */
  joinNote?: string;
}

export async function listTeam(token: string): Promise<Team> {
  const { data, error } = await operatorApi(token).GET("/team", {});
  if (error) throw error;
  return {
    people: (data.team ?? []).map(toTeamPerson),
    joinUrl: data.joinUrl,
    joinNote: data.joinNote,
  };
}
