"use server";

import { requireOperator } from "@/lib/auth/session";
import { searchBookings } from "@/lib/money/fetch";
import type { BookingLine } from "@/lib/money/bookings";

/**
 * One more page of bookings — yuvoy-operator#57 item 8.
 *
 * The cursor is passed back untouched and with the same filters, because the
 * API refuses one sent with a different query: "a cursor this list did not
 * issue is a `400`, and so is a cursor from one view sent with another." That
 * is the whole reason changing a filter drops the pages already loaded rather
 * than trying to carry them.
 */
export async function loadMoreBookings(params: {
  view: "upcoming" | "past" | "cancelled";
  q: string;
  experienceId: string;
  from: string;
  to: string;
  cursor: string;
}): Promise<
  | { ok: true; items: BookingLine[]; complete: boolean; nextCursor?: string }
  | { ok: false; message: string }
> {
  const { token } = await requireOperator();
  const page = await searchBookings(token, params);
  if (!page) return { ok: false, message: "Those did not load. Try again." };
  return {
    ok: true,
    items: page.items,
    complete: page.complete,
    nextCursor: page.nextCursor,
  };
}
