"use client";

import type { RequestView } from "@/lib/day/request-view";
import {
  DeclinedReceipt,
  GrantedReceipt,
  HeldRow,
  NotSentRow,
} from "./answer-rows";
import type { Answer, AnswerKind } from "./answer-store";
import { RequestCard } from "./request-card";

/** A request, in whichever state its answer has reached. */
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
  switch (answer?.phase) {
    case "holding":
    case "sending":
      return <HeldRow answer={answer} onUndo={onUndo} />;
    case "granted":
      return <GrantedReceipt receipt={answer.receipt} />;
    case "declined":
      return <DeclinedReceipt answer={answer} />;
    case "failed":
      if (!present) return <NotSentRow answer={answer} />;
      break;
    default:
      break;
  }
  return (
    <RequestCard
      view={view}
      {...(kind ? { kind } : {})}
      canAnswer={canAnswer}
      canAccept={canAccept}
      onAccept={onAccept}
      onDecline={onDecline}
      focus={focus}
      {...(answer?.phase === "failed"
        ? {
            message: answer.message,
            ...(answer.seeBusiness ? { seeBusiness: true } : {}),
          }
        : {})}
    />
  );
}
