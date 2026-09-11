import "server-only";
import { cache } from "react";
import { operatorApi } from "@/lib/api/server-client";

export type { OpenRequest } from "./request-types";

/**
 * Requests waiting for an answer.
 *
 * The list arrives ordered by how soon each expires rather than when it
 * arrived — the contract says why, and it is the whole shape of the screen:
 * "the queue's job is to stop requests dying, so the one closest to death is
 * first." This does not re-sort it.
 *
 * `cache`d for the request (yuvoy-operator#42): the root layout counts this
 * list for the Bookings badge, and Today and Bookings both render it, so one
 * render asks once. A Server Action is its own request and reads it fresh.
 */
export const listOpenRequests = cache(async (token: string) => {
  const { data, error } = await operatorApi(token).GET("/requests", {});
  if (error) throw error;
  return data.requests ?? [];
});
