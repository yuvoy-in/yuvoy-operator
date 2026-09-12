import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import type { Manifest, OperatorListing, OperatorSlot } from "./types";
import { apiWindow, inMarketDays } from "./calendar";
import { dedash } from "@/lib/format/dedash";

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

/**
 * Departures on a run of MARKET days, ordered first-off-first.
 *
 * `from` and `to` are the market's dates — what an operator means by "today" —
 * and the API reads them as UTC days. Asked for as they are, a 05:00 IST
 * departure drops off its own morning (it is 23:30 UTC the evening before)
 * and tomorrow's turns up tonight, on the day screen as much as the calendar.
 * So the request is widened by a day either side and the answer cut back to
 * the days that were asked for. See `apiWindow`.
 */
export async function listSlots(
  token: string,
  from: string,
  to: string,
): Promise<OperatorSlot[]> {
  const asked = apiWindow(from, to);
  const { data, error } = await operatorApi(token).GET("/slots", {
    params: { query: { from: asked.from, to: asked.to } },
  });
  if (error) throw error;

  const slots = (data.items ?? []).map((s): OperatorSlot => ({
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
    /*
        Whether a traveller can buy it, and the API's sentence when not. Left
        out when absent, for the same reason as `bookingMode`: an older API
        sending neither must not read as a calendar of boats nobody can book.
      */
    ...(typeof s.onSale === "boolean" ? { onSale: s.onSale } : {}),
    ...(s.notOnSaleReason ? { notOnSaleReason: s.notOnSaleReason } : {}),
    ...(s.notOnSaleDetail
      ? { notOnSaleDetail: dedash(s.notOnSaleDetail) }
      : {}),
  }));

  return inMarketDays(slots, from, to).sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
}

/**
 * The operator's listings, for the departure picker.
 *
 * `GET /operator/v1/experiences` — one call, every listing, no date window.
 *
 * ## What this replaces, and why it mattered
 *
 * This used to scan `GET /slots` across ±120 days and take listing ids off
 * whatever departures came back. That made the picker a function of the
 * departures a listing already had, which is circular: **a listing with none
 * could never be given any** (yuvoy-operator#32). The asymmetric window was
 * an attempt to soften it — the operator who most needs to add a departure is
 * the one whose schedule has run out — and it could not fix the case that
 * actually happens, which is a listing created an hour ago.
 *
 * It also meant Services and Capacity disagreed about what a listing is: one
 * read `/experiences`, the other read departures, and a listing existed on
 * one tab and not the other.
 *
 * ## Why it still returns `null` rather than throwing
 *
 * Unchanged, and for the unchanged reason: this is a picker for a form, not
 * the screen's subject. If the listings cannot be read the fortnight of
 * departures is still editable, and taking a working seat-editing screen down
 * to an error page over a form nobody opened is the wrong trade. The form
 * says "we could not load your listings", which is a different sentence from
 * "you appear to have none" — two different facts, and only one of them is a
 * reason to message us.
 */
export async function listListings(
  token: string,
): Promise<OperatorListing[] | null> {
  let data;
  try {
    const res = await operatorApi(token).GET("/experiences", {});
    if (res.error) throw res.error;
    data = res.data;
  } catch {
    return null;
  }

  return (data.experiences ?? [])
    .filter((e) => Boolean(e.id))
    .map((e) => ({
      id: e.id as string,
      title: e.title ?? "Untitled listing",
      ...(e.status ? { status: e.status } : {}),
      ...(typeof e.sellable === "boolean" ? { sellable: e.sellable } : {}),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "en"));
}
