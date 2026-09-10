import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import type { ChangeRequest, Earnings, EarningsState } from "./earnings";
import { toCommission, type Commission } from "./commission";
import { byDeparture, toBookingLine, type BookingLine } from "./bookings";

export async function getEarnings(
  token: string,
  from: string,
  to: string,
): Promise<Earnings> {
  const { data, error } = await operatorApi(token).GET("/earnings", {
    params: { query: { from, to } },
  });
  if (error) throw error;

  return {
    from: data.from,
    to: data.to,
    bookings: data.bookings ?? 0,
    grossPaise: data.grossPaise ?? 0,
    commissionPaise: data.commissionPaise ?? 0,
    refundsPaise: data.refundsPaise ?? 0,
    netPaise: data.netPaise ?? 0,
    state: (data.state ?? "provisional") as EarningsState,
  };
}

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
): Promise<BookingLine[] | null> {
  try {
    const { data, error } = await operatorApi(token).GET("/bookings", {
      params: { query: { from, to } },
    });
    if (error) throw error;
    return (data.items ?? []).map(toBookingLine).sort(byDeparture);
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
