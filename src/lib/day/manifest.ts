import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import type { Manifest, OperatorListing, OperatorSlot } from "./types";
import { inMarketDays } from "./calendar";
import type { Closure } from "./closures";
import { dedash } from "@/lib/format/dedash";
import type { MediaItem } from "@/lib/services/media";

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
  /*
    `from` and `to` are MARKET days, inclusive, and are sent as asked.

    This used to widen the range by a day either side and cut the answer back,
    because the API read these as UTC days: a 05:00 IST departure is 23:30 UTC
    the evening before, so asking for its own day missed it. The contract now
    says "the first day to include, in the market's clock" on both ends, so the
    widening asked for two days nobody wanted and `inMarketDays` threw them away
    again (yuvoy-operator#45 item 6).
  */
  const items: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  /*
    Paged until `complete`. A fortnight of departures across several listings
    passes 50 easily, and the page that went missing would be the far end of the
    fortnight: the days an operator is planning, which is what this screen is
    for. The ceiling is there so a broken cursor cannot spin.
  */
  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await operatorApi(token).GET("/slots", {
      params: { query: { from, to, ...(cursor ? { cursor } : {}) } },
    });
    if (error) throw error;
    items.push(...((data.items ?? []) as Record<string, unknown>[]));
    if (data.complete !== false || !data.nextCursor) break;
    cursor = data.nextCursor;
  }

  const slots = items.map((raw): OperatorSlot => {
    const s = raw as {
      id?: string;
      title?: string;
      startsAt?: string;
      timezone?: string;
      seats?: number;
      sold?: number;
      remaining?: number;
      soldOffline?: number;
      bookingMode?: string;
      experienceId?: string;
      status?: string;
      onSale?: boolean;
      notOnSaleReason?: string;
      notOnSaleDetail?: string;
    };
    return {
      id: s.id ?? "",
      title: s.title ?? "Departure",
      // Left out when absent rather than defaulted: a departure attributed to
      // the wrong listing would put somebody else's boat on a listing's row.
      ...(s.experienceId ? { experienceId: s.experienceId } : {}),
      startsAt: s.startsAt ?? "",
      timezone: s.timezone ?? "Asia/Kolkata",
      seats: s.seats ?? 0,
      sold: s.sold ?? 0,
      remaining: s.remaining ?? 0,
      /*
        Carried only as a whole number of at least one. Absent (an older API)
        and zero both say nothing on the card, and a count that is not a
        count must not become a sentence about people at the counter.
      */
      ...(Number.isInteger(s.soldOffline) && (s.soldOffline as number) > 0
        ? { soldOffline: s.soldOffline }
        : {}),
      /*
        Left undefined when absent rather than defaulted. `allotment` is the
        commoner mode and would be the tempting default, and it is the one that
        makes a claim: it would put "3 seats left" against a departure that
        holds nothing until the operator answers.
      */
      ...(s.bookingMode
        ? { bookingMode: s.bookingMode as OperatorSlot["bookingMode"] }
        : {}),
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
    };
  });

  /*
    Still filtered to the market days asked for. The API is the authority now,
    so this should be a no-op — and it stays because it is cheap and because a
    departure on the wrong day is the kind of thing that puts somebody at a
    jetty on a Tuesday for a Wednesday boat.
  */
  return inMarketDays(slots, from, to).sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  );
}

/** Every media item read, and whether the read reached the end. */
export interface MediaList {
  items: MediaItem[];
  /**
   * False when the walk stopped short: a later page failed, or the ceiling
   * below was reached. A screen says so rather than letting the oldest items
   * quietly not exist.
   */
  complete: boolean;
}

/**
 * Every media item this operator holds, paged to the end.
 *
 * One read for the whole screen: Home shows a tile per listing and `posterFor`
 * picks each one out of this list, rather than asking per listing — the same
 * rule the fortnight of departures follows, and for the same reason. The
 * profile's Reels tab draws the same list, and its sheet reads the rest of each
 * row, which is why the type is the contract's own rather than the three fields
 * a poster needs.
 *
 * ## Paged since yuvoy-api#204 (op#95 item 2)
 *
 * It read one call, which is the 50 newest, so past 50 the oldest reels
 * vanished from Home and from the Reels grid, and could then be neither
 * published nor withdrawn from either. It now walks `nextCursor` the way the
 * bookings list does, and stops on `complete` ("stop when there is no
 * `nextCursor`, not when a page comes back short"). An older API sends neither
 * field and one page, which reads as complete: what it always was.
 *
 * The FIRST page failing is the read failing, and it throws for the caller to
 * degrade as it always has. A LATER page failing keeps what arrived and says
 * it is partial, because a grid of the newest two hundred is worth more than
 * an empty one.
 */
export async function listMedia(token: string): Promise<MediaList> {
  const items: MediaItem[] = [];
  let cursor: string | undefined;

  // 25 pages of 200 is 5,000 items: a ceiling so a broken cursor cannot spin.
  for (let page = 0; page < 25; page += 1) {
    let data;
    try {
      const res = await operatorApi(token).GET("/media", {
        params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } },
      });
      if (res.error) throw res.error;
      data = res.data;
    } catch (err) {
      if (page === 0) throw err;
      return { items, complete: false };
    }

    items.push(...(data.items ?? []));
    if (data.complete !== false || !data.nextCursor) {
      return { items, complete: true };
    }
    cursor = data.nextCursor;
  }

  return { items, complete: false };
}

/**
 * Every closure touching a range of market days, paged to the end.
 *
 * Read rather than inferred (yuvoy-operator#45 item 1): a day with no
 * departures on it can be closed, and only this call knows it. Reopened
 * closures come back too, carrying `reopenedAt`, and `inForce` is what tells
 * them apart.
 */
export async function listClosures(
  token: string,
  from: string,
  to: string,
): Promise<Closure[]> {
  const items: Closure[] = [];
  let cursor: string | undefined;

  for (let page = 0; page < 20; page += 1) {
    const { data, error } = await operatorApi(token).GET("/blackouts", {
      params: {
        query: { from, to, limit: 200, ...(cursor ? { cursor } : {}) },
      },
    });
    if (error) throw error;

    for (const raw of data.items ?? []) {
      items.push({
        id: raw.id ?? "",
        from: raw.from ?? "",
        to: raw.to ?? "",
        reasonCode: raw.reasonCode ?? "OTHER",
        ...(raw.note ? { note: raw.note } : {}),
        ...(raw.experienceId ? { experienceId: raw.experienceId } : {}),
        ...(raw.departureId ? { departureId: raw.departureId } : {}),
        ...(raw.reopenedAt ? { reopenedAt: raw.reopenedAt } : {}),
        departureIds: raw.departureIds ?? [],
      });
    }

    /*
      "Told rather than inferred … Do not infer the end from a short page." A
      full last page and a partial one are the same length and a different
      answer, and the page that went missing would be a closure the calendar
      then draws as open.
    */
    if (data.complete !== false || !data.nextCursor) break;
    cursor = data.nextCursor;
  }

  return items;
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
      // Presence IS the state, so it is carried rather than read. See the
      // field's note on `OperatorListing`.
      ...(e.sentBack ? { sentBack: e.sentBack } : {}),
      ...(Number.isInteger(e.bookableDatesNext30Days) &&
      (e.bookableDatesNext30Days as number) >= 0
        ? { bookableDatesNext30Days: e.bookableDatesNext30Days }
        : {}),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "en"));
}
