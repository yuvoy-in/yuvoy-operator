import "server-only";
import { cache } from "react";
import { listThreads } from "@/lib/messages/fetch";

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
 * `cache`d for the request, like `readMe` and `listOpenRequests`: the root
 * layout reads this for the inbox and Home reads it again, and on Home that
 * is one walk, not two. A Server Action is its own request and reads fresh.
 *
 * ## It never throws, and it never guesses
 *
 * `null` is "we could not read it": the layout draws no count and Home draws
 * no row, which is what an empty inbox draws too, and only one of those is
 * true. A zero would be a number nobody measured. The same rule the tab bar's
 * badges keep.
 *
 * Paged at 200, the API's maximum, because this is a sum and nothing is drawn
 * per row. The ceiling stops a broken cursor spinning; stopping at it
 * undercounts a figure that is only a prompt to look, and says what it has.
 */
export interface InboxCount {
  /** Messages from travellers nobody at the business has marked read. */
  messages: number;
  /** Conversations with at least one of those in them: one guest each. */
  conversations: number;
}

const MAX_PAGES = 10;

export const readInbox = cache(
  async (token: string): Promise<InboxCount | null> => {
    try {
      let messages = 0;
      let conversations = 0;
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const { rows, complete, nextCursor } = await listThreads(
          token,
          cursor,
          200,
        );
        for (const row of rows) {
          // A negative or fractional count is not a count; it adds nothing.
          const unread =
            Number.isInteger(row.unreadCount) && row.unreadCount > 0
              ? row.unreadCount
              : 0;
          messages += unread;
          if (unread > 0) conversations += 1;
        }
        if (complete || !nextCursor) break;
        cursor = nextCursor;
      }
      return { messages, conversations };
    } catch {
      return null;
    }
  },
);
