import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import type { ChangeRequest, Earnings, EarningsState } from "./earnings";

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
