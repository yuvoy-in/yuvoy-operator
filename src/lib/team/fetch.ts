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
 * `GET /team` carries no role gate — every role may read it. Only the writes
 * are OWNER only, and the screen says so up front rather than after a tap.
 */
export async function listTeam(token: string): Promise<TeamPerson[]> {
  const { data, error } = await operatorApi(token).GET("/team", {});
  if (error) throw error;
  return (data.team ?? []).map(toTeamPerson);
}
