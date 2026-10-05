"use client";

import { useCallback, useRef, type ReactElement } from "react";
import type { RequestView } from "@/lib/day/request-view";
import {
  fadeIn,
  followersOf,
  slideFrom,
  topsOf,
  type Tops,
} from "@/lib/motion/flip";
import { MeasureBefore } from "@/lib/motion/measure-before";
import {
  DeclinedReceipt,
  GrantedReceipt,
  HeldRow,
  NotSentRow,
} from "./answer-rows";
import type { Answer, AnswerKind } from "./answer-store";
import { RequestCard } from "./request-card";

/**
 * A request, in whichever state its answer has reached.
 *
 * ## Each step lands in place (O02 A, approved 4 Oct 2026)
 *
 * Answering swaps a 200px card for a 90px row, the row for its receipt, and
 * back again on Undo, and each swap used to move everything under the
 * operator's thumb in one frame. Now the new row fades in where the old one
 * stood (150ms) and whatever follows it slides to its new place (200ms,
 * `--ease-move`), measured before the commit that swaps them, so the eye can
 * follow the list closing up rather than finding it moved. The held row
 * draws its five seconds as a bar (`HeldRow`); the receipt's tick draws
 * itself. Under reduced motion the row fades in 120ms and nothing slides.
 */
export function RequestItem({
  kind,
  view,
  answer,
  present,
  canAnswer,
  canAccept,
  focus,
  onAccept,
  onDecline,
  onUndo,
}: {
  /** "Seat request", on a list that holds other kinds of card. */
  kind?: string;
  view: RequestView;
  answer?: Answer;
  /** Whether the server still lists it as waiting. */
  present: boolean;
  canAnswer: boolean;
  canAccept: boolean;
  focus?: AnswerKind;
  onAccept: () => void;
  onDecline: Parameters<typeof RequestCard>[0]["onDecline"];
  onUndo: () => void;
}) {
  const row = useRef<HTMLLIElement>(null);
  const setRow = useCallback((el: HTMLLIElement | null) => {
    row.current = el;
  }, []);
  const { step, node } = drawn();

  return (
    <MeasureBefore<Tops>
      watch={step}
      capture={() =>
        row.current ? topsOf(followersOf(row.current)) : new Map()
      }
      apply={(before) => {
        if (row.current) fadeIn(row.current);
        slideFrom(before);
      }}
    >
      {node}
    </MeasureBefore>
  );

  /** Which row the answer has reached, and the row itself. */
  function drawn(): { step: string; node: ReactElement } {
    switch (answer?.phase) {
      case "holding":
      case "sending":
        return {
          step: "held",
          node: <HeldRow answer={answer} onUndo={onUndo} rowRef={setRow} />,
        };
      case "granted":
        return {
          step: "granted",
          node: <GrantedReceipt receipt={answer.receipt} rowRef={setRow} />,
        };
      case "declined":
        return {
          step: "declined",
          node: <DeclinedReceipt answer={answer} rowRef={setRow} />,
        };
      case "failed":
        if (!present) {
          return {
            step: "not-sent",
            node: <NotSentRow answer={answer} rowRef={setRow} />,
          };
        }
        break;
      default:
        break;
    }
    return {
      step: "card",
      node: (
        <RequestCard
          view={view}
          {...(kind ? { kind } : {})}
          canAnswer={canAnswer}
          canAccept={canAccept}
          onAccept={onAccept}
          onDecline={onDecline}
          focus={focus}
          rowRef={setRow}
          {...(answer?.phase === "failed"
            ? {
                message: answer.message,
                ...(answer.seeBusiness ? { seeBusiness: true } : {}),
              }
            : {})}
        />
      ),
    };
  }
}
