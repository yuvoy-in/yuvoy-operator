"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { declineSentence } from "@/lib/day/request-types";
import { panelClass } from "@/components/ui/panel";
import { CheckIcon } from "@/components/ui/icons";
import { HOLD_MS, type Answer, type Receipt } from "./answer-store";

/**
 * The rows an answer leaves where its card was: held with an Undo, on its
 * way, and the receipt once the API has answered.
 *
 * ## Focus follows the answer
 *
 * The card's button is gone the moment it is pressed, and the Undo after it
 * is gone five seconds later. A keyboard or screen-reader user left on
 * `<body>` each time has lost their place in the queue. So each of these rows
 * takes focus when it arrives AND focus has nowhere else to be: it never
 * pulls focus away from somebody typing a reply further down.
 */
export function useTakeFocusIfLost(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body) {
      ref.current?.focus({ preventScroll: true });
    }
  }, [ref]);
}

/** "Accepting Reuben Mathai, 2 people", with Undo while it can still be taken back. */
export function HeldRow({
  answer,
  onUndo,
}: {
  answer: Extract<Answer, { phase: "holding" } | { phase: "sending" }>;
  onUndo: () => void;
}) {
  const undo = useRef<HTMLButtonElement>(null);
  const row = useRef<HTMLLIElement>(null);
  const [left, setLeft] = useState(Math.ceil(HOLD_MS / 1000));
  const holding = answer.phase === "holding";
  const until = holding ? answer.until : 0;

  useEffect(() => {
    if (!holding) return;
    const tick = () =>
      setLeft(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [holding, until]);

  // The Undo is the one thing to press now; the card's button went with the card.
  useEffect(() => {
    const active = document.activeElement;
    if (holding && (!active || active === document.body)) {
      undo.current?.focus({ preventScroll: true });
    }
  }, [holding]);
  useTakeFocusIfLost(row);

  const verb = answer.kind === "accept" ? "Accepting" : "Declining";
  const who = answer.kind === "accept" ? answer.view.title : answer.view.name;

  return (
    <li
      ref={row}
      tabIndex={-1}
      className={panelClass("outline", "flex items-center gap-3 p-4")}
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-bold">
          {verb} {who}
        </p>
        <p className="text-forest/80 mt-0.5 text-sm">
          {holding ? (
            <>
              Sending in{" "}
              <span className="tabular-nums">
                {left} {left === 1 ? "second" : "seconds"}
              </span>
            </>
          ) : (
            "Sending…"
          )}
        </p>
      </div>
      {holding ? (
        <button
          ref={undo}
          type="button"
          onClick={onUndo}
          className="border-forest/25 hover:border-forest dock-target label ease-interaction shrink-0 rounded-full border px-5 font-bold transition-colors duration-200"
        >
          Undo
        </button>
      ) : null}
    </li>
  );
}

/**
 * Accepting is not the end. The traveller now holds seats with a clock on
 * them and must pay before it lapses; an operator who reads "accepted" as
 * "booked" will not chase it, and the seats go back.
 *
 * The API's `receipt` sentence since yuvoy-api#203; ours only for an API that
 * sends none, with the pay-by time worked out the same way. `toldBy` empty
 * means nobody could reach the traveller, so the receipt turns into a warning.
 */
export function GrantedReceipt({ receipt }: { receipt: Receipt }) {
  const row = useRef<HTMLLIElement>(null);
  useTakeFocusIfLost(row);
  return (
    <li
      ref={row}
      tabIndex={-1}
      className={panelClass(receipt.untold ? "alert" : "done")}
    >
      <p className="flex items-center gap-2 text-base font-bold">
        {receipt.untold ? null : <CheckIcon className="size-4 shrink-0" />}
        Seats granted to {receipt.contactName}
      </p>
      <p className="text-forest/80 mt-2 text-sm">
        {receipt.sentence ??
          `They are holding ${receipt.guests} ${
            receipt.guests === 1 ? "seat" : "seats"
          } and still have to pay. ${
            receipt.payBy
              ? `If they have not paid by ${receipt.payBy}, the seats come back to you.`
              : "If they do not, the seats come back to you."
          }`}
      </p>
      {receipt.untold && !receipt.sentence ? (
        <p className="text-terra-deep mt-2 text-sm font-bold">
          We could not reach them, so they do not know yet. Tell them yourself
          if you can.
        </p>
      ) : null}
    </li>
  );
}

/** A decline, with the sentence the traveller was sent. */
export function DeclinedReceipt({
  answer,
}: {
  answer: Extract<Answer, { phase: "declined" }>;
}) {
  const row = useRef<HTMLLIElement>(null);
  useTakeFocusIfLost(row);
  return (
    <li ref={row} tabIndex={-1} className={panelClass("done")}>
      <p className="flex items-center gap-2 text-base font-bold">
        <CheckIcon className="size-4 shrink-0" />
        Declined {answer.view.name}
      </p>
      {answer.reasonCode ? (
        <p className="text-forest/80 mt-2 text-sm">
          They read: {declineSentence(answer.reasonCode)}
        </p>
      ) : null}
    </li>
  );
}

/**
 * An answer that did not go, for a request the queue no longer has: answered
 * on another phone, or out of time. Said where the card was, so the operator
 * is not left believing their answer landed.
 */
export function NotSentRow({
  answer,
}: {
  answer: Extract<Answer, { phase: "failed" }>;
}) {
  const row = useRef<HTMLLIElement>(null);
  useTakeFocusIfLost(row);
  return (
    <li ref={row} tabIndex={-1} role="alert" className={panelClass("alert")}>
      <p className="text-terra-deep text-base font-bold">
        Not sent to {answer.view.name}
      </p>
      <p className="text-forest/80 mt-1 text-sm">{answer.message}</p>
    </li>
  );
}
