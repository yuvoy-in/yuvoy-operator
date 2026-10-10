import "server-only";
import { cache } from "react";
import { readMe } from "@/lib/auth/session";
import { listThreads } from "@/lib/messages/fetch";
import type { ThreadRow } from "@/lib/messages/thread";
import { UNREAD_ROWS_KEPT, type InboxCount } from "./inbox-count";

export type { InboxCount } from "./inbox-count";

/** Pages of 200 walked before stopping. */
const MAX_PAGES = 10;

/** The two numbers, without the rows. */
export type InboxTotals = Pick<InboxCount, "messages" | "conversations">;

/**
 * What is unread across every conversation, read once per render.
 *
 * The number that matters is CONVERSATIONS with something unread in them: one
 * guest waiting on a reply each. It is what the inbox control at the right
 * edge of every signed-in screen's stage carries (yuvoy-operator#96) and what
 * Home's "Needs you" says ("2 guests wrote to you"), and the two must not
 * disagree. A guest who sends five messages is one reply to write, not five,
 * which is how a phone's chat app counts too. The message total rides along
 * for anything that wants it.
 *
 * ## Counted by the API, where it counts
 *
 * `GET /me` carries both numbers since yuvoy-api#282 item 6 (#295), "added up
 * in one read, so a client no longer walks every page of threads to show a
 * badge". `readMe` is the read every page already makes, so the counts cost
 * nothing, and Home's rows are ONE page of `GET /message-threads?unread=true`,
 * only the conversations with something unread, asked only when there is
 * one. The same answer the walk below gave, in one read instead of up to ten.
 *
 * An API from before that sends no counts, and absent means the old
 * behaviour: the walk, exactly as it was. So does a `/me` that did not
 * answer, because the walk is a measurement and an unknown is not.
 *
 * `cache`d for the request, like `readMe` and `listOpenRequests`: Home reads
 * this, and a page that asks twice reads once. A Server Action is its own
 * request and reads fresh.
 *
 * ## It never throws, and it never guesses
 *
 * `null` is "we could not read it": Home says "Messages did not load" rather
 * than drawing nothing, which is what an empty inbox draws. A zero would be a
 * number nobody measured. The same rule the tab bar's badges keep.
 */
export const readInbox = cache(
  async (token: string): Promise<InboxCount | null> => {
    const counted = await countedByTheApi(token);
    if (!counted) return walkInbox(token);
    if (counted.conversations === 0) return { ...counted, unread: [] };
    try {
      /*
        The filter goes on every page of a walk, and this is one page: the
        rows Home keeps, not a sum. `conversations` stays the API's count
        even when this page comes back short (one was read in between):
        Home then says how many more wrote rather than drawing fewer guests
        than are waiting.
      */
      const { rows } = await listThreads(token, undefined, UNREAD_ROWS_KEPT, {
        unread: true,
      });
      const unread: ThreadRow[] = [];
      for (const row of rows) {
        const count = unreadIn(row);
        if (count > 0 && row.bookingId && unread.length < UNREAD_ROWS_KEPT) {
          unread.push({ ...row, unreadCount: count });
        }
      }
      return { ...counted, unread };
    } catch {
      return null;
    }
  },
);

/**
 * Just the two numbers, for the inbox control the root layout draws on every
 * signed-in screen. On an API that counts them that is `GET /me`, which the
 * layout reads anyway, so a screen that is not Home asks for no rows at all.
 * On an older API it is the walk, as before, and Home reads that same walk
 * (`cache`d), so it is still made once.
 */
export const readInboxTotals = cache(
  async (token: string): Promise<InboxTotals | null> => {
    const counted = await countedByTheApi(token);
    if (counted) return counted;
    const walked = await walkInbox(token);
    return walked
      ? { messages: walked.messages, conversations: walked.conversations }
      : null;
  },
);

/**
 * Unread messages by booking, for a departure's rows on an API whose manifest
 * does not count them per party (from before yuvoy-api#260). `null` when it
 * could not be read, which draws no flag rather than a zero.
 *
 * Always the walk: `GET /me` counts the business, not each booking. A
 * manifest that carries `unreadCount` on its parties never asks for this.
 */
export async function readUnreadByBooking(
  token: string,
): Promise<Record<string, number> | null> {
  return (await walkInbox(token))?.unreadByBooking ?? null;
}

/**
 * The two counts `GET /me` carries, or `null` when it sent none (an API
 * before yuvoy-api#295) or did not answer. Both or neither: a messages total
 * with no conversation count cannot fill the badge, which counts guests.
 */
async function countedByTheApi(token: string): Promise<InboxTotals | null> {
  try {
    const me = await readMe(token);
    const messages = me.unreadCount;
    const conversations = me.unreadConversations;
    return isCount(messages) && isCount(conversations)
      ? { messages, conversations }
      : null;
  } catch {
    return null;
  }
}

/**
 * Every conversation, walked and added up: how the counts were made before
 * the API made them, and still how they are made on an API that does not.
 *
 * Paged at 200, the API's maximum, because this is a sum and nothing is drawn
 * per row. The ceiling stops a broken cursor spinning; stopping at it
 * undercounts a figure that is only a prompt to look, and says what it has.
 */
const walkInbox = cache(async (token: string): Promise<InboxCount | null> => {
  try {
    let messages = 0;
    let conversations = 0;
    const unreadRows: ThreadRow[] = [];
    const unreadByBooking: Record<string, number> = {};
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { rows, complete, nextCursor } = await listThreads(
        token,
        cursor,
        200,
      );
      for (const row of rows) {
        const unread = unreadIn(row);
        messages += unread;
        if (unread > 0) {
          conversations += 1;
          if (row.bookingId) {
            unreadByBooking[row.bookingId] = unread;
            if (unreadRows.length < UNREAD_ROWS_KEPT) {
              unreadRows.push({ ...row, unreadCount: unread });
            }
          }
        }
      }
      if (complete || !nextCursor) break;
      cursor = nextCursor;
    }
    return { messages, conversations, unread: unreadRows, unreadByBooking };
  } catch {
    return null;
  }
});

/** A negative or fractional count is not a count; it adds nothing. */
function unreadIn(row: ThreadRow): number {
  return isCount(row.unreadCount) ? row.unreadCount : 0;
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}
