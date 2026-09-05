import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import type { Manifest, OperatorListing, OperatorSlot } from "./types";

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
      /*
        Left undefined when absent rather than defaulted. `allotment` is the
        commoner mode and would be the tempting default, and it is the one that
        makes a claim: it would put "3 seats left" against a departure that
        holds nothing until the operator answers.
      */
      ...(s.bookingMode ? { bookingMode: s.bookingMode } : {}),
      status: s.status ?? "open",
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/**
 * How far either side of today to look for the operator's listings.
 *
 * Wider than the fortnight `/capacity` edits, and asymmetric on purpose. The
 * operator who most needs to add a departure is the one with none in the next
 * two weeks — the start of a season, or a schedule that has run out — and
 * their listings are visible only in departures that have already sailed. A
 * picker built from the editing window alone would be empty exactly when it
 * matters.
 */
const LISTING_LOOKBACK_DAYS = 120;
const LISTING_LOOKAHEAD_DAYS = 120;

function shiftDate(day: string, days: number): string {
  const t = Date.parse(`${day}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The operator's listings, as far as they can be known.
 *
 * See `OperatorListing`: there is no endpoint that enumerates them, so this
 * reads them off the departures they appear on. An empty result means "we
 * cannot see any", never "you have none" — and the screen says the former,
 * because they are different sentences and only one of them is ours to say.
 *
 * Deduplicated by id, with the most recently seen title winning: a listing
 * renamed since its older departures should show under the name it has now.
 */
export async function listListings(
  token: string,
  today: string,
): Promise<OperatorListing[] | null> {
  let data;
  try {
    const res = await operatorApi(token).GET("/slots", {
      params: {
        query: {
          from: shiftDate(today, -LISTING_LOOKBACK_DAYS),
          to: shiftDate(today, LISTING_LOOKAHEAD_DAYS),
        },
      },
    });
    if (res.error) throw res.error;
    data = res.data;
  } catch {
    /*
      `null`, not a throw, and this is the only fetch in the portal that
      swallows one.

      Every other read on `/capacity` is the screen's subject: if the fortnight
      cannot be loaded there is nothing to render and the error boundary is
      right. This one is a picker for a form, over a window nine times wider
      than the screen edits — the widest range this portal asks of `GET /slots`
      anywhere. If the API rejects or times out on that range while answering
      the fortnight fine, letting it throw would take a working seat-editing
      screen down to an error page over a form nobody had opened.

      So it degrades to "we could not load your trips", which the form says in
      different words from "you appear to have none" — the two are different
      facts and only one of them is a reason to message us.
    */
    return null;
  }

  const byId = new Map<string, OperatorListing>();
  for (const s of [...(data.items ?? [])].sort((a, b) =>
    (a.startsAt ?? "").localeCompare(b.startsAt ?? ""),
  )) {
    if (!s.experienceId) continue;
    byId.set(s.experienceId, {
      id: s.experienceId,
      title: s.title ?? "Your trip",
    });
  }
  return [...byId.values()].sort((a, b) =>
    a.title.localeCompare(b.title, "en"),
  );
}
