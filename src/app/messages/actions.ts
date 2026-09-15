"use server";

import { requireOperator } from "@/lib/auth/session";
import { listThreads } from "@/lib/messages/fetch";
import type { ThreadRow } from "@/lib/messages/thread";

/**
 * One more page of conversations — yuvoy-operator#52 item 5.
 *
 * "One walk keeps its order": the first page fixed the moment the walk began,
 * and every page of that walk is ordered as of that moment, so a conversation
 * written in while somebody pages is neither skipped nor shown twice. That is
 * the API's promise and this action does nothing to break it — it passes the
 * cursor back untouched and never re-sorts what comes home.
 */
export async function loadMoreThreads(
  cursor: string,
): Promise<
  | { ok: true; rows: ThreadRow[]; complete: boolean; nextCursor?: string }
  | { ok: false; message: string }
> {
  const { token } = await requireOperator();
  try {
    const page = await listThreads(token, cursor);
    return {
      ok: true,
      rows: page.rows,
      complete: page.complete,
      nextCursor: page.nextCursor,
    };
  } catch {
    return { ok: false, message: "Those did not load. Try again." };
  }
}
