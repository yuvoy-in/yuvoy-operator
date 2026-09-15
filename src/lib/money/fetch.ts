import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import { marketDate } from "@/lib/format/market-time";
import type { ChangeRequest } from "./earnings";
import { toCommission, type Commission } from "./commission";
import type { Settlement } from "./settlements";
import {
  byDeparture,
  toBookingCash,
  toBookingLine,
  type BookingCash,
  type BookingLine,
} from "./bookings";

/**
 * Change requests, only so the earnings screen can say a payout is held.
 *
 * Failing softly on purpose: a bank change nobody can read is a missing
 * warning, and a missing warning is better than an earnings page that will not
 * load. The hold is surfaced when we know about it and simply absent when the
 * call fails, which is the honest degradation.
 */
export async function getChangeRequests(
  token: string,
): Promise<ChangeRequest[]> {
  try {
    const { data, error } = await operatorApi(token).GET(
      "/change-requests",
      {},
    );
    if (error) throw error;
    return data.requests ?? [];
  } catch {
    return [];
  }
}

/**
 * The bookings departing in a window, with what each contributed.
 *
 * Soft-failing, but not the way `getChangeRequests` is. That one degrades to
 * an absent warning; this one is a section of the screen, so its two
 * failures must never render alike: `null` is "we could not load it" and the
 * screen says so, `[]` is "nothing departed in this window" and the screen
 * says that instead. Either way the totals above it stay up — a list that
 * could not load must not take the number down with it.
 */
export async function listBookings(
  token: string,
  from: string,
  to: string,
  view?: "upcoming" | "past" | "cancelled",
): Promise<BookingLine[] | null> {
  try {
    const items: BookingLine[] = [];
    let cursor: string | undefined;

    /*
      Paged to the end (yuvoy-operator#45 item 3).

      It used to be one call of at most 100 rows, and the caller could not tell
      a full page from a cut-short one — so the calendar threw the count away
      whenever 100 came back and said "anybody already confirmed" instead of "4
      guests are already confirmed". A fortnight of a busy operator's bookings
      passes 100 easily, which meant the number was missing exactly when it
      mattered most.

      `complete` is read rather than the page's length, for the same reason: a
      full last page and a partial one are the same length and a different
      answer.
    */
    for (let page = 0; page < 25; page += 1) {
      const { data, error } = await operatorApi(token).GET("/bookings", {
        params: {
          query: {
            from,
            to,
            limit: 200,
            ...(view ? { view } : {}),
            ...(cursor ? { cursor } : {}),
          },
        },
      });
      if (error) throw error;
      items.push(...(data.items ?? []).map(toBookingLine));
      if (data.complete !== false || !data.nextCursor) break;
      cursor = data.nextCursor;
    }

    return items.sort(byDeparture);
  } catch {
    return null;
  }
}

/**
 * Which bookings on one departure are paid at the counter — yuvoy-operator#40 §1.
 *
 * `Manifest.parties[]` carries no cash at all, and `OperatorBooking` does, so
 * the manifest joins this by booking id. One request for the whole departure,
 * never one per row: a jetty on one bar of signal does not get a round trip
 * for every party.
 *
 * ## The window asks for both readings of the day
 *
 * `from` and `to` are declared as bare dates, and the API reads them as UTC
 * days — `from` is UTC midnight and `to` runs to the next one — while every
 * date an operator sees is the market's. A 05:00 IST departure is 23:30 UTC
 * the evening before, so asking only for its market day would miss it. Asking
 * from the earlier of the two dates to the later covers both, and the join is
 * by id, so a wider window costs nothing but rows that are ignored.
 *
 * ## `null` is "could not tell", and it is kept apart from "no cash"
 *
 * The result maps a booking id to its cash (`BookingCash`) or to `null` when
 * the booking was read and is paid online. An id MISSING from the map was not
 * read at all — the call failed, or the list was cut short — and the screen
 * says it could not check rather than treating that booking as settled. The
 * failure the other way is somebody waved onto a boat owing ₹10,000.
 */
export async function cashForDeparture(
  token: string,
  startsAt: string,
  timezone: string,
): Promise<Map<string, BookingCash | null> | null> {
  const instant = new Date(startsAt);
  if (Number.isNaN(instant.getTime())) return null;

  const utc = instant.toISOString().slice(0, 10);
  const market = marketDate(instant, timezone);
  const [from, to] = utc <= market ? [utc, market] : [market, utc];

  try {
    const { data, error } = await operatorApi(token).GET("/bookings", {
      params: { query: { from, to } },
    });
    if (error) throw error;

    const byBooking = new Map<string, BookingCash | null>();
    for (const raw of data.items ?? []) {
      if (!raw.id) continue;
      byBooking.set(raw.id, toBookingCash(raw.cash) ?? null);
    }
    return byBooking;
  } catch {
    return null;
  }
}

/**
 * What is owed on cash already taken — yuvoy-operator#40 §2.
 *
 * Hard-failing, unlike the two soft reads above. This IS the screen: there is
 * nothing else on it to keep up, and a balance that quietly renders as zero
 * because a request failed is the one wrong answer that must never appear —
 * an operator who reads "nothing owed" stops expecting a bill.
 */
export async function getCommissionOwed(token: string): Promise<Commission> {
  const { data, error } = await operatorApi(token).GET("/commission-owed", {});
  if (error) throw error;
  return toCommission(data);
}

/* ---------------------------------------------------- settlements (op#47) -- */

/**
 * The whole top of the earnings screen, in one read.
 *
 * HARD-failing, unlike `getEarnings` above it was replacing nothing: this IS
 * the screen. There is nothing else on it to keep up, and four money figures
 * that quietly render as zero because a request failed is the one wrong answer
 * that must never appear. An operator who reads "₹0 next settlement" concludes
 * we owe them nothing.
 */
export async function getSettlementOverview(token: string) {
  const { data, error } = await operatorApi(token).GET(
    "/settlements/overview",
    {},
  );
  if (error) throw error;
  return data;
}

/**
 * Past payout weeks, most recent first.
 *
 * SOFT-failing, and the distinction from the overview above is deliberate: the
 * history is a section, so `null` is "we could not load it" and the screen says
 * so while the figures above stay up. A list that could not load must not take
 * the numbers down with it.
 *
 * `complete` is read rather than the page's length. The contract says so in as
 * many words: "Told rather than inferred. Do not infer the end from a short
 * page."
 */
export async function listSettlements(
  token: string,
  cursor?: string,
): Promise<{
  items: Settlement[];
  complete: boolean;
  nextCursor: string | null;
} | null> {
  try {
    const { data, error } = await operatorApi(token).GET("/settlements", {
      params: { query: { limit: 50, ...(cursor ? { cursor } : {}) } },
    });
    if (error) throw error;
    return {
      items: data.items ?? [],
      complete: data.complete ?? true,
      nextCursor: data.nextCursor ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * One payout week with the bookings it paid.
 *
 * Hard-failing: a settlement detail with no lines is a blank page pretending to
 * be a statement. `404` reaches the caller as an `OperatorApiError` so the
 * route can answer with the not-found screen, which is what the issue asks for.
 */
export async function getSettlement(token: string, id: string) {
  const { data, error } = await operatorApi(token).GET("/settlements/{id}", {
    params: { path: { id } },
  });
  if (error) throw error;
  return data;
}
