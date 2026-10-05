import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import { toChangeRequest, type ChangeRequest } from "@/lib/account/change-kind";
import { toCommission, type Commission } from "./commission";
import type {
  CommissionPayTo,
  CommissionStatement,
} from "./commission-statements";
import type { Settlement } from "./settlements";
import { toCounts, type Counts } from "@/lib/bookings/list";
import { byDeparture, toBookingLine, type BookingLine } from "./bookings";

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
    // Narrowed here, once, so no screen can compare against a kind the API
    // never writes. See `change-kind.ts`.
    return (data.requests ?? []).map(toChangeRequest);
  } catch {
    return [];
  }
}

/**
 * The same list, for the one screen whose subject it is: Payout details.
 *
 * `null` when the read failed, where `getChangeRequests` answers `[]`. On the
 * screens that borrow the list for a warning, a failed read is a missing
 * warning; on Payout details an empty list means "nothing on file, nothing in
 * flight" and draws the form straight away, which is the wrong thing to show
 * an owner whose account and open change simply did not load.
 */
export async function readChangeRequests(
  token: string,
): Promise<ChangeRequest[] | null> {
  try {
    const { data, error } = await operatorApi(token).GET(
      "/change-requests",
      {},
    );
    if (error) throw error;
    // Narrowed on the way in, as `getChangeRequests` does. See `change-kind.ts`.
    return (data.requests ?? []).map(toChangeRequest);
  } catch {
    return null;
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

export interface BookingPage {
  items: BookingLine[];
  complete: boolean;
  nextCursor?: string;
  /** `null` when the answer carried none: unknown, never zeroes. */
  counts: Counts | null;
}

/**
 * ONE page of bookings, with the counts behind every pill — #57 item 3.
 *
 * Deliberately not `listBookings`, which pages to the end for a total. This
 * screen shows a page and offers the next, because "search, filters and counts
 * run on the server, so they stay right at any number of bookings": a busy
 * operator's Past is thousands of rows and nobody is scrolling them.
 *
 * `counts` is the reason a pill can say how many it holds without reading it.
 * It honours `q`, `experienceId`, `from` and `to` and ignores `view` and the
 * page, so the four badges stay put while somebody switches between them.
 */
export async function searchBookings(
  token: string,
  params: {
    view?: "upcoming" | "past" | "cancelled";
    q?: string;
    experienceId?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  },
): Promise<BookingPage | null> {
  try {
    const { data, error } = await operatorApi(token).GET("/bookings", {
      params: {
        query: {
          ...(params.view ? { view: params.view } : {}),
          ...(params.q ? { q: params.q } : {}),
          ...(params.experienceId ? { experienceId: params.experienceId } : {}),
          ...(params.from ? { from: params.from } : {}),
          ...(params.to ? { to: params.to } : {}),
          limit: params.limit ?? 100,
          ...(params.cursor ? { cursor: params.cursor } : {}),
        },
      },
    });
    if (error) throw error;

    return {
      items: (data.items ?? []).map(toBookingLine),
      /*
        Told rather than inferred, and a short page is not the end: "stop when
        there is no `nextCursor`, not when a page comes back short."
      */
      complete: data.complete ?? true,
      nextCursor: data.nextCursor,
      /*
        Zeroes are a real answer and are kept. An absent `counts` is not: the
        contract marks it required, so a response without one is not the API
        this was built against, and drawing four zeroes would say a busy
        operator has nothing. So it is `null`, unknown (`toCounts`); it was
        four zeroes, which is exactly that claim (the audit, O6).
      */
      counts: toCounts(data.counts),
    };
  } catch {
    /*
      `null` is "we could not load it", which the screen says in one line with a
      way to try again — and it draws NO pill badges, because a badge from a
      failed read is a number somebody would plan against.
    */
    return null;
  }
}

/**
 * Yuvoy's share on cash already taken (yuvoy-operator#40 §2).
 *
 * Hard-failing, unlike the two soft reads above. This IS the screen: there is
 * nothing else on it to keep up, and a balance that quietly renders as zero
 * because a request failed is the one wrong answer that must never appear.
 *
 * Since D-043 this is every completed cash trip, "billed or not, paid or
 * not". What is still to pay is on the statements (`readCommissionStatements`),
 * so no screen calls this figure "owed".
 */
export async function getCommissionOwed(token: string): Promise<Commission> {
  const { data, error } = await operatorApi(token).GET("/commission-owed", {});
  if (error) throw error;
  return toCommission(data);
}

/**
 * The same read, for a screen where cash is one section among several: the
 * Money tab's summary (yuvoy-operator#96).
 *
 * SOFT-failing, where `getCommissionOwed` is hard, and for the reason that one
 * is hard: on `/cash` the balance IS the screen, while on Money a failed read
 * must cost the cash figures and nothing else. `null` is "we could not read
 * it", and the caller draws no cash figure at all rather than a ₹0.
 */
export async function readCommissionOwed(
  token: string,
): Promise<Commission | null> {
  try {
    return await getCommissionOwed(token);
  } catch {
    return null;
  }
}

/* --------------------------------------- commission statements (op#121) -- */

export interface CommissionStatements {
  /** Every statement read, newest first, as the API sends them. */
  items: CommissionStatement[];
  /**
   * Whether that is all of them. A total built on a list cut short
   * understates a bill, so `totalOwed` answers nothing without it.
   */
  complete: boolean;
  payTo: CommissionPayTo;
}

/**
 * Every weekly commission statement, and where to pay them (D-043).
 *
 * HARD-failing, for the one screen whose subject this is: the list of
 * statements. Paged to the end, because what is owed is the sum over all of
 * them and a statement left unread is a bill left out of it. Ten pages of 200
 * is about forty years of weeks; past that, `complete` stays false and the
 * screens say they could not add it up rather than draw a smaller number.
 */
export async function getCommissionStatements(
  token: string,
): Promise<CommissionStatements> {
  const items: CommissionStatement[] = [];
  let payTo: CommissionPayTo | undefined;
  let complete = false;
  let cursor: string | undefined;

  for (let page = 0; page < 10; page += 1) {
    const { data, error } = await operatorApi(token).GET(
      "/commission-statements",
      { params: { query: { limit: 200, ...(cursor ? { cursor } : {}) } } },
    );
    if (error) throw error;
    items.push(...(data.items ?? []));
    payTo ??= data.payTo;

    /*
      Told rather than inferred: "`false` means there is more to read with
      `nextCursor`". A page that says there is more and gives no way to it
      leaves the list incomplete, never quietly finished.
    */
    const more =
      data.complete === false ||
      (data.complete === undefined && Boolean(data.nextCursor));
    if (!more) {
      complete = true;
      break;
    }
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }

  // Required by the contract. Absent, it is not the API this was built
  // against, and nobody is offered somewhere to pay that it never named.
  return { items, complete, payTo: payTo ?? { available: false } };
}

/**
 * The same read, for the screens where commission is one part among several:
 * Money, Cash and Today.
 *
 * SOFT-failing, where `getCommissionStatements` is hard, for the reason
 * `readCommissionOwed` is soft: a failed read costs what is owed and nothing
 * else on the screen. `null` is "we could not read it", and every caller says
 * so rather than draw a ₹0, which tells an operator with a bill that they owe
 * nothing.
 */
export async function readCommissionStatements(
  token: string,
): Promise<CommissionStatements | null> {
  try {
    return await getCommissionStatements(token);
  } catch {
    return null;
  }
}

/**
 * One statement, with its trips, its payments and where to pay it.
 *
 * Hard-failing: a bill with no trips on it is a blank page pretending to be a
 * statement. Another business's statement answers `404`, exactly as one that
 * does not exist, and reaches the caller as an `OperatorApiError` so the route
 * answers with the not-found screen.
 */
export async function getCommissionStatement(token: string, id: string) {
  const { data, error } = await operatorApi(token).GET(
    "/commission-statements/{id}",
    { params: { path: { id } } },
  );
  if (error) throw error;
  return data;
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
