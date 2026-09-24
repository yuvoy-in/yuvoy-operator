"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { loadMoreThreads } from "./actions";
import {
  lastActivityLabel,
  tripLine,
  unreadLabel,
  type ThreadPage,
  type ThreadRow,
} from "@/lib/messages/thread";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { panelClass } from "@/components/ui/panel";
import { ChevronRightIcon } from "@/components/ui/icons";

/**
 * The conversations list — yuvoy-operator#52 item 5.
 *
 * ## Why `now` is a prop
 *
 * Every row says how long ago it was written in, and `Date.now()` during render
 * is impure — the React compiler refuses it, and it would also make the server's
 * HTML and the client's first paint disagree by however long the request took.
 * The server's instant is passed down, the same rule `lastSeen` on Team follows.
 *
 * It is a single instant for the whole list on purpose: two rows written in the
 * same minute must not read as different ages because they rendered a tick
 * apart.
 */
export function ThreadList({
  initial,
  now,
}: {
  initial: ThreadPage;
  now: number;
}) {
  const [page, setPage] = useState(initial);
  const [failure, setFailure] = useState<string | null>(null);
  const [loading, start] = useTransition();

  function more() {
    const cursor = page.nextCursor;
    if (!cursor) return;
    setFailure(null);
    start(async () => {
      const next = await loadMoreThreads(cursor);
      if (!next.ok) {
        setFailure(next.message);
        return;
      }
      setPage((was) => ({
        // APPENDED: this list reads newest-first, so a later page is older.
        rows: [...was.rows, ...next.rows],
        complete: next.complete,
        nextCursor: next.nextCursor,
      }));
    });
  }

  return (
    <>
      <ul className="space-y-3">
        {page.rows.map((row) => (
          <li key={row.bookingId}>
            <ThreadRowLink row={row} now={now} />
          </li>
        ))}
      </ul>

      {failure ? (
        <p role="alert" className="text-terra-deep mt-4 text-sm font-bold">
          {failure}
        </p>
      ) : null}

      {/*
        `complete` is told by the API rather than inferred from a page's length,
        so a full last page does not leave a button that loads nothing.
      */}
      {!page.complete && page.nextCursor ? (
        <div className="mt-4">
          <Button
            variant="secondary"
            block={false}
            disabled={loading}
            onClick={more}
          >
            {loading ? "Loading…" : "Show more"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

/**
 * One conversation, read the way a person recognises it (yuvoy-operator#83
 * s6): who, then the trip and its time, then the last message, then whether
 * anything is unread. The reference comes last and small, because it is what
 * somebody reads out to support, not how anybody finds a conversation.
 *
 * ## Who, when the list does not say
 *
 * `MessageThreadSummary` carries no traveller's name and no message text, by
 * the contract ("never its text, never the traveller's name"). So the row
 * leads with the trip, which is what it led with before, and says the last
 * message as who wrote it and when. A name slots in above the trip the day the
 * list carries one; nothing here guesses at a field the contract does not
 * declare.
 *
 * ## Unread is a dot, and the count is spoken
 *
 * A filled dot scans at a glance down a list, and a number in it was one more
 * thing to read. The count is in the row's accessible name, so a screen reader
 * hears "2 unread messages" rather than a dot it cannot see.
 */
function ThreadRowLink({ row, now }: { row: ThreadRow; now: number }) {
  const unread = row.unreadCount > 0;
  const trip = tripLine(row.startsAt, row.timezone);
  const last = lastActivityLabel(row.lastMessageAt, now, row.timezone);
  // A row with no trip name leads with its reference, and says it once.
  const lead = row.experience || row.reference;
  const reference = row.experience ? row.reference : "";

  return (
    /*
      Straight to the conversation on that booking, not to the top of the
      booking screen: somebody arriving from here has already decided which
      conversation they are answering.
    */
    <Link
      href={`/bookings/${row.bookingId}#conversation`}
      className={panelClass(
        "raised",
        "ease-interaction hover:bg-paper flex items-center gap-3 px-4 py-4 transition-colors duration-200",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 truncate text-base font-bold">{lead}</span>
          {unread ? (
            <>
              <span
                aria-hidden="true"
                className="bg-terra-deep mt-1.5 size-2.5 shrink-0 rounded-full"
              />
              <span className="sr-only">{unreadLabel(row.unreadCount)}</span>
            </>
          ) : null}
        </span>
        {trip ? (
          <span className="text-forest/80 mt-0.5 block text-sm tabular-nums">
            {trip}
          </span>
        ) : null}
        {/*
          Who wrote last, because it decides whether this row needs anybody. A
          conversation the business answered is waiting on the traveller, and a
          read message nobody replied to is still waiting on the business.
        */}
        <span
          className={cn(
            "mt-1 block text-sm",
            unread ? "text-forest font-bold" : "text-forest/70",
          )}
        >
          {row.lastFrom === "operator" ? "You wrote" : "They wrote"}
          {last ? ` ${last}` : ""}
        </span>
        {reference ? (
          <span className="text-forest/70 mt-1 block font-mono text-xs tracking-wider">
            {reference}
          </span>
        ) : null}
      </span>
      <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
    </Link>
  );
}
