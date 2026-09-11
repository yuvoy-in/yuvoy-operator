"use client";

import { useCallback, useState } from "react";
import { Empty } from "@/components/ui/states";
import type { OpenRequest } from "@/lib/day/request-types";
import { GrantedReceipt, RequestRow, type Receipt } from "./request-row";

/**
 * The queue, and the receipts that must outlive it.
 *
 * The list is the server's: `/requests` is force-dynamic, and `RefreshOnFocus`
 * re-renders it on every focus and every minute so a request that expired or
 * was answered on another phone leaves the screen. That is right for the
 * queue and wrong for the one thing an accept produces — the receipt saying
 * the traveller now holds seats and **still has to pay**.
 *
 * That receipt used to live inside the row, and the row lives inside the
 * server-rendered list. Accept a request, flip to WhatsApp to tell the
 * traveller to pay, flip back: the focus refresh re-rendered the queue
 * without the accepted request, the row unmounted, and the receipt went with
 * it. The exact misunderstanding the screen exists to prevent — "accepted
 * means booked" — restored by the mechanism meant to keep the screen fresh.
 *
 * So receipts are held HERE, above the list, in client state a refresh cannot
 * reach. `router.refresh()` reconciles rather than remounts, so this component
 * keeps its state while the `requests` prop underneath it changes. A real
 * navigation clears it, which is correct: by then the queue is the truth.
 */
export function RequestQueue({
  requests,
  canAnswer,
  at,
  today,
  tomorrow,
}: {
  requests: OpenRequest[];
  canAnswer: boolean;
  /** When the page rendered, on the server's clock. Each row's age reads it. */
  at: number;
  today: string;
  tomorrow: string;
}) {
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  const onGranted = useCallback((receipt: Receipt) => {
    setReceipts((prev) =>
      prev.some((r) => r.id === receipt.id) ? prev : [...prev, receipt],
    );
  }, []);

  // A request with a receipt is answered, whatever the server's list still
  // says for the next few seconds — showing both is showing a decision twice.
  const waiting = requests.filter(
    (request) => !receipts.some((r) => r.id === request.id),
  );

  if (receipts.length === 0 && waiting.length === 0) {
    return (
      <Empty
        title="Nothing waiting"
        body="When somebody asks for seats on a request-mode departure, it appears here with a clock on it."
      />
    );
  }

  return (
    <ul className="space-y-3">
      {receipts.map((receipt) => (
        <GrantedReceipt key={`granted-${receipt.id}`} receipt={receipt} />
      ))}
      {waiting.map((request) => (
        <RequestRow
          key={request.id}
          request={request}
          canAnswer={canAnswer}
          onGranted={onGranted}
          at={at}
          today={today}
          tomorrow={tomorrow}
        />
      ))}
    </ul>
  );
}
