import "server-only";
import { operatorApi } from "@/lib/api/server-client";
import type {
  BookingThread,
  ThreadMessage,
  ThreadPage,
  ThreadRow,
} from "./thread";

/**
 * Reading conversations: yuvoy-operator#52.
 *
 * Both calls HARD-fail, and that is the point of the file:
 *
 *   - `getBookingThread` is the conversation itself, and a booking screen that
 *     quietly drew no messages would say "nothing was ever said here", which is
 *     a claim rather than an absence.
 *   - `listThreads` is the list `/messages` draws, and the issue asks for
 *     "Conversations did not load." with a way to try again rather than an
 *     empty state that lies.
 *
 * The unread count the inbox control and Home draw is `readInbox`
 * (`lib/site/inbox.ts`), which catches and says it could not read.
 */

/**
 * One page of a booking's conversation. The FIRST page is the most recent
 * messages, and `nextCursor` walks backwards through what came before.
 */
export async function getBookingThread(
  token: string,
  id: string,
  cursor?: string,
): Promise<BookingThread> {
  const { data, error } = await operatorApi(token).GET(
    "/bookings/{id}/messages",
    {
      params: {
        path: { id },
        /*
          50 is the API's own default, sent explicitly so the page size this
          client pages with is the page size it asked for. An unstated default
          is one somebody changes on the other side.
        */
        query: { limit: 50, ...(cursor ? { cursor } : {}) },
      },
    },
  );
  if (error) throw error;

  return {
    messages: (data.messages ?? []) as ThreadMessage[],
    complete: data.complete ?? true,
    nextCursor: data.nextCursor,
    unreadCount: data.unreadCount ?? 0,
    /*
      Absent `canWrite` is read as FALSE, which is the safe direction: the worst
      a missing composer does is send somebody to the phone, and the worst a
      composer that should not be there does is take a message somebody believes
      was delivered and answer it with a 409 after they have walked away.
    */
    canWrite: data.canWrite === true,
    closedReason: data.closedReason,
    writableUntil: data.writableUntil,
  };
}

function toRow(raw: {
  bookingId?: string;
  reference?: string;
  experience?: string;
  slot?: { startsAt?: string; timezone?: string };
  lastMessageAt?: string;
  lastFrom?: string;
  unreadCount?: number;
}): ThreadRow {
  return {
    bookingId: raw.bookingId ?? "",
    reference: raw.reference ?? "",
    experience: raw.experience ?? "",
    startsAt: raw.slot?.startsAt,
    /*
      The departure's own zone, never the device's. A 7am dive shown as 1:30am
      is a missed boat, and this row is what somebody scans to decide which
      conversation is urgent.
    */
    timezone: raw.slot?.timezone ?? "Asia/Kolkata",
    lastMessageAt: raw.lastMessageAt,
    lastFrom: raw.lastFrom,
    unreadCount: raw.unreadCount ?? 0,
  };
}

/** One page of conversations, most recently active first. */
export async function listThreads(
  token: string,
  cursor?: string,
  limit = 50,
): Promise<ThreadPage> {
  const { data, error } = await operatorApi(token).GET("/message-threads", {
    params: { query: { limit, ...(cursor ? { cursor } : {}) } },
  });
  if (error) throw error;

  return {
    rows: (data.threads ?? []).map(toRow),
    /*
      `complete` is "told rather than inferred", so it is read rather than
      derived from the page being short. A full last page and a partial one are
      the same length question and a different answer.
    */
    complete: data.complete ?? true,
    nextCursor: data.nextCursor,
  };
}
