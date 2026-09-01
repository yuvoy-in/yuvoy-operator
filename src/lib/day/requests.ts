import "server-only";
import { operatorApi } from "@/lib/api/server-client";

export type { OpenRequest } from "./request-types";

/**
 * Requests waiting for an answer.
 *
 * The list arrives ordered by how soon each expires rather than when it
 * arrived — the contract says why, and it is the whole shape of the screen:
 * "the queue's job is to stop requests dying, so the one closest to death is
 * first." This does not re-sort it.
 */
export async function listOpenRequests(token: string) {
  const { data, error } = await operatorApi(token).GET("/requests", {});
  if (error) throw error;
  return data.requests ?? [];
}
