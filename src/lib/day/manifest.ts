import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import type { Manifest, OperatorSlot } from "./types";

export * from "./types";

export async function getManifest(
  token: string,
  slotId: string,
): Promise<Manifest> {
  const { data, error } = await operatorApi(token).GET("/slots/{id}/manifest", {
    params: { path: { id: slotId } },
    // The endpoint also serves `text/csv` — `?format=csv` is how an operator
    // gets a diffable file when the head count and the app disagree. This call
    // never asks for it, and says so rather than letting content negotiation
    // decide.
    headers: { Accept: "application/json" },
  });
  if (error) throw error;

  /*
    A runtime narrowing rather than a cast. The response type is a union
    because the endpoint can answer CSV, and `as Manifest` would silently
    hand a string to code that reads `.parties` — a blank screen with no
    error, on a dock. This says what happened instead.
  */
  if (typeof data === "string") {
    throw new Error(
      "The manifest came back as CSV. This call asks for JSON; check the Accept header.",
    );
  }
  return data;
}

/** Departures in a date range, ordered first-off-first. */
export async function listSlots(
  token: string,
  from: string,
  to: string,
): Promise<OperatorSlot[]> {
  const { data, error } = await operatorApi(token).GET("/slots", {
    params: { query: { from, to } },
  });
  if (error) throw error;

  return (data.items ?? [])
    .map((s) => ({
      id: s.id ?? "",
      title: s.title ?? "Departure",
      startsAt: s.startsAt ?? "",
      timezone: s.timezone ?? "Asia/Kolkata",
      seats: s.seats ?? 0,
      sold: s.sold ?? 0,
      remaining: s.remaining ?? 0,
      status: s.status ?? "open",
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
