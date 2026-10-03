"use client";

import { useState } from "react";
import { HOLD_MS, type Answer } from "./answer-store";

const HOLD_WORDS = `Sending in ${HOLD_MS / 1000} seconds. Undo is next.`;

/**
 * Says each step of an answer out loud: held, taken back, granted, declined,
 * not sent.
 *
 * One polite region that is always in the page, because a region inserted
 * with its words already in it is announced by some screen readers and not
 * others. The rows themselves stay quiet; the countdown in particular is not
 * read out every second.
 */
export function AnswerAnnouncer({
  answers,
}: {
  answers: Readonly<Record<string, Answer>>;
}) {
  /*
    The answers as of the last render, so each change is said once, worked
    out while rendering rather than in an effect (React's "storing
    information from previous renders").
  */
  const [previous, setPrevious] = useState(answers);
  const [said, setSaid] = useState("");
  if (answers !== previous) {
    setPrevious(answers);
    const lines = changes(previous, answers);
    if (lines.length > 0) setSaid(lines.join(" "));
  }

  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {said}
    </p>
  );
}

/** What changed between two renders, as sentences. */
function changes(
  before: Readonly<Record<string, Answer>>,
  after: Readonly<Record<string, Answer>>,
): string[] {
  const lines: string[] = [];
  for (const [id, answer] of Object.entries(after)) {
    if (before[id]?.phase === answer.phase) continue;
    const line = sentenceFor(answer);
    if (line) lines.push(line);
  }
  for (const [id, was] of Object.entries(before)) {
    if (!after[id] && was.phase === "holding") {
      lines.push("Undone. Nothing was sent.");
    }
  }
  return lines;
}

function sentenceFor(answer: Answer): string | null {
  switch (answer.phase) {
    case "holding":
      return answer.kind === "accept"
        ? `Accepting ${answer.view.title}. ${HOLD_WORDS}`
        : `Declining ${answer.view.name}. ${HOLD_WORDS}`;
    case "granted":
      return `Seats granted to ${answer.view.name}. They still have to pay.`;
    case "declined":
      return `Declined ${answer.view.name}.`;
    case "failed":
      return `Not sent. ${answer.message}`;
    default:
      return null;
  }
}
