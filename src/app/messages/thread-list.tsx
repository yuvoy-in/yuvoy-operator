"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { loadMoreThreads } from "./actions";
import {
  lastActivityLabel,
  tripLine,
  type ThreadPage,
} from "@/lib/messages/thread";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
            {/*
              Straight to the conversation on that booking, not to the top of
              the booking screen: somebody arriving from here has already decided
              which conversation they are answering.
            */}
            <Link
              href={`/bookings/${row.bookingId}#conversation`}
              className={panelClass(
                "raised",
                "ease-interaction hover:bg-cream flex items-center justify-between gap-4 transition-colors duration-200",
              )}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm tracking-wider">
                    {row.reference}
                  </span>
                  {row.unreadCount > 0 ? (
                    <Chip tone="accent">{row.unreadCount}</Chip>
                  ) : null}
                </span>
                <span className="mt-1 block truncate text-base font-bold">
                  {row.experience}
                </span>
                <span className="text-forest/70 mt-1 block text-sm">
                  {tripLine(row.startsAt, row.timezone)}
                </span>
                <span className="text-forest/70 mt-1 block text-xs">
                  {/*
                    Who wrote last, because it decides whether this row needs
                    anybody. A conversation the business answered is waiting on
                    the traveller, and an unread chip is not the only way that
                    can be true: a read message nobody replied to still is.
                  */}
                  {row.lastFrom === "operator" ? "You wrote" : "They wrote"}{" "}
                  {lastActivityLabel(row.lastMessageAt, now, row.timezone)}
                </span>
              </span>
              <ChevronRightIcon className="text-terra-deep size-5 shrink-0" />
            </Link>
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
