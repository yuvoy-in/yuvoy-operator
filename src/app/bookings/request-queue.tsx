"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { RequestView } from "@/lib/day/request-view";
import { sameOrder, stableOrder } from "@/lib/site/stable-order";
import { AnswerAnnouncer } from "@/components/requests/answer-announcer";
import type { AnswerKind } from "@/components/requests/answer-store";
import { RequestItem } from "@/components/requests/request-item";
import { useAnswers } from "@/components/requests/use-answers";

/**
 * The queue, and the answers that must outlive it.
 *
 * The list is the server's: `/bookings` is force-dynamic, and
 * `RefreshOnFocus` re-renders it on every focus and every minute so a request
 * that expired or was answered on another phone leaves the screen. That is
 * right for the queue and wrong for what an answer leaves behind: the five
 * seconds an answer is held with its Undo, and the receipt saying the
 * traveller now holds seats and **still has to pay**.
 *
 * Accept a request, flip to WhatsApp to tell the traveller to pay, flip back:
 * the focus refresh re-renders the queue without the accepted request. So the
 * answers live HERE, above the list, in a store a refresh cannot reach, and
 * each keeps the place its card had (`stableOrder`). The same card, store
 * and receipts Home uses (`components/requests`), so the two screens answer
 * a request the same way. A real navigation clears it, which is correct: by
 * then the queue is the truth.
 */
export function RequestQueue({
  views,
  empty,
  canAnswer,
  canAccept,
  pinPill = true,
}: {
  /** The requests, every word worked out on the server (`requestView`). */
  views: RequestView[];
  /** What an empty queue says, under the filters it was read with. */
  empty: string;
  canAnswer: boolean;
  /** Accepting is refused while suspended; declining is not (#50). */
  canAccept: boolean;
  /**
   * Write `?view=requests` into the address (see below). Only Bookings has
   * pills; a queue shown elsewhere (the board's inspector) leaves the
   * address alone.
   */
  pinPill?: boolean;
}) {
  const router = useRouter();
  const refresh = useCallback(() => {
    if (navigator.onLine) router.refresh();
  }, [router]);
  const { answers, store } = useAnswers(refresh);
  const [restore, setRestore] = useState<Record<string, AnswerKind>>({});

  /*
    Pin the pill this queue is on. Bare `/bookings` opens on Requests only
    while something is waiting, so answering the LAST request turned the next
    re-read into Upcoming, and the queue, with that answer's receipt, went
    with the pill. Writing `?view=requests` into the address (no navigation:
    Next's router follows `replaceState`, and `null` is what lets it) makes
    every re-read after it ask for this pill.
  */
  useEffect(() => {
    if (!pinPill) return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("view")) return;
    url.searchParams.set("view", "requests");
    window.history.replaceState(null, "", url);
  }, [pinPill]);

  const byId = new Map(views.map((view) => [view.id, view]));
  const serverIds = views.map((view) => view.id);
  const [order, setOrder] = useState<string[]>(serverIds);
  const next = stableOrder(order, serverIds, new Set(Object.keys(answers)));
  if (!sameOrder(next, order)) setOrder(next);

  const rows = next.flatMap((id) => {
    const answer = answers[id];
    const view = byId.get(id) ?? answer?.view;
    if (!view) return [];
    return [
      <RequestItem
        key={id}
        view={view}
        answer={answer}
        present={byId.has(id)}
        canAnswer={canAnswer}
        canAccept={canAccept}
        focus={restore[id]}
        onAccept={() => store.hold("accept", view)}
        onDecline={(reason) => store.hold("decline", view, reason)}
        onUndo={() => {
          const kind = answer?.kind;
          if (store.undo(id) && kind) {
            setRestore((was) => ({ ...was, [id]: kind }));
          }
        }}
      />,
    ];
  });

  return (
    <>
      <AnswerAnnouncer answers={answers} />
      {rows.length === 0 ? (
        <p className="text-forest/70 leading-body text-base text-pretty">
          {empty}
        </p>
      ) : (
        <ul className="space-y-3">{rows}</ul>
      )}
    </>
  );
}
