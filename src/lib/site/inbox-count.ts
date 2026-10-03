import type { ThreadRow } from "@/lib/messages/thread";

/**
 * What is unread across every conversation: the shape `readInbox` answers
 * with, kept apart from it because that module is `server-only` and the
 * screens that draw these numbers include client components.
 */
export interface InboxCount {
  /** Messages from travellers nobody at the business has marked read. */
  messages: number;
  /** Conversations with at least one of those in them: one guest each. */
  conversations: number;
  /**
   * Those conversations, most recently active first, for Home to answer in
   * place. At most `UNREAD_ROWS_KEPT`; `conversations` is still the count.
   */
  unread: ThreadRow[];
}

/** How many unread conversations the walk keeps rows for. Home draws three. */
export const UNREAD_ROWS_KEPT = 20;
