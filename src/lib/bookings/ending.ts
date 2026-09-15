import { CALL_OFF_REASONS } from "@/lib/day/relay-types";

/**
 * Why a booking ended, who ended it, and what the party answered — #43.
 *
 * ## One line, and it has to be right about WHO
 *
 * An operator reading "cancelled" with no attribution assumes it was us, and
 * the most common truth is that the traveller did it themselves. Getting this
 * wrong turns a routine cancellation into a support message, and occasionally
 * into an accusation.
 *
 * ## And it must never say more than it knows
 *
 * `reasonCode` is a closed set with a documented escape: "if you meet a value
 * you do not recognise, say the booking was cancelled, and by whom." So an
 * unknown code falls through to the plainest line rather than being guessed at,
 * and `by` being absent removes the attribution rather than inventing one.
 *
 * `SAFETY` in particular "covers any judgement that the trip was not safe for
 * this party, including one about their health, which is never reported more
 * precisely than that" — so nothing here ever elaborates on it.
 */

export type CancelledBy = "traveller" | "operator" | "yuvoy" | "system";

/**
 * Who ended it, in the operator's terms.
 *
 * `system` gets a clause rather than a noun because "the system cancelled it"
 * answers nothing an operator can act on, and the contract says exactly what it
 * means: "a payment we could not honour when it arrived: the booking was
 * declined as it was made, and anything taken was refunded in full."
 */
const BY_LABEL: Record<CancelledBy, string> = {
  operator: "your team",
  yuvoy: "Yuvoy",
  traveller: "the traveller",
  system: "Yuvoy, because the payment could not be honoured",
};

/** The call-off list's labels, from the one place they are already written. */
const REASON_LABEL = new Map<string, string>(
  CALL_OFF_REASONS.map((r) => [r.code, r.label]),
);

export interface Cancellation {
  at?: string;
  by?: string;
  reasonCode?: string;
  calledOff?: { reasonCode?: string };
  operatorCancelled?: { reasonCode?: string };
}

/** "12 Sep" — the day a booking ended, with no weekday and no year. */
export function dayAndMonth(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // September renders as "Sept" in every English locale; sliced so the months
  // read as one set. The same call `shortDay` makes for the conversations list.
  return `${get("day")} ${get("month").slice(0, 3)}`;
}

/**
 * The one line a cancelled or declined booking carries, or `null` when there is
 * nothing trustworthy to say.
 *
 * `at` is required by the contract, and without it there is no line: "cancelled
 * by your team" with no date is a fact an operator cannot place against
 * anything, and the date is the half they use to work out what happened.
 */
export function endingLine(
  cancellation: Cancellation | undefined,
  timeZone: string,
): string | null {
  if (!cancellation?.at) return null;
  const when = dayAndMonth(cancellation.at, timeZone);
  if (when === " ") return null;

  const who = cancellation.by
    ? BY_LABEL[cancellation.by as CancelledBy]
    : undefined;
  // "When `by` is absent, leave out who" — not "by somebody", which reads as a
  // person we are declining to name.
  const byWho = who ? ` by ${who}` : "";

  const calledOff = cancellation.calledOff?.reasonCode;

  /*
    `system` is the one actor whose label is a CLAUSE rather than a noun, and
    the issue's template puts it in front of the date: "Cancelled by Yuvoy,
    because the payment could not be honoured on 12 Sep" attaches the date to
    the payment instead of to the cancellation, and reads as though something
    was honoured that day.

    Every word the issue specified is kept and only the order moves, and only
    for this actor. A payment we could not honour carries no call-off or
    operator reason to append — the booking "was declined as it was made" — so
    there is nothing to lose by taking it early; if one ever did arrive, it
    falls through to the ordinary template below.
  */
  if (
    cancellation.by === "system" &&
    !calledOff &&
    !cancellation.operatorCancelled?.reasonCode
  ) {
    return `Cancelled on ${when} by ${BY_LABEL.system}`;
  }

  if (calledOff) {
    return `Called off${byWho} on ${when}: ${REASON_LABEL.get(calledOff) ?? calledOff}`;
  }

  const ourReason = cancellation.operatorCancelled?.reasonCode;
  if (ourReason) {
    return `Cancelled${byWho} on ${when}: ${REASON_LABEL.get(ourReason) ?? ourReason}`;
  }

  switch (cancellation.reasonCode) {
    case "CUSTOMER_REQUEST":
    case "TRAVELLER_REQUEST":
      return `Cancelled${byWho} on ${when}: the traveller asked`;
    case "OPERATOR_MOVED_IT":
      /*
        "The traveller cancelled from their link after you moved the departure",
        so `by` is `traveller` and the line says so regardless of what arrives.
        It is the one case where the reason and the actor are the same fact, and
        an operator reading it needs to know the move is what caused it.
      */
      return `Cancelled by the traveller on ${when} after the departure was moved`;
    default:
      // Including a code this build has never heard of. "Say the booking was
      // cancelled, and by whom", and nothing more.
      return `Cancelled${byWho} on ${when}`;
  }
}

/**
 * Whether the party has to be checked before the trip — and nothing else from
 * screening, ever.
 *
 * `needsAttention` is "somebody has not answered the health question, or
 * something in what they answered needs a look", and it is NOT derivable from
 * the answers: the manifest fixture carries a party flagged by the server with
 * `clear: true` beside it. A client that computed one would get that party
 * wrong, in the direction where somebody dives who should not have.
 */
export function needsReview(
  screening: { needsAttention?: boolean } | undefined,
): boolean {
  return screening?.needsAttention === true;
}

export interface PartyQuestion {
  questionId: string;
  text: string;
  answered: boolean;
  answer?: string;
  current: boolean;
}

/** What to print under a question. Never a blank. */
export const NOT_ANSWERED = "Not answered yet";

/**
 * The answer, or the sentence that stands in for one.
 *
 * Unanswered and DELETED read identically, and that is the contract's own
 * design: "afterwards every question the listing still asks reads
 * `answered: false` … exactly as a question never answered reads." So the copy
 * cannot distinguish them, and must not try — telling an operator an answer was
 * deleted when it was never given is a claim about a traveller.
 */
export function answerFor(question: PartyQuestion): string {
  if (!question.answered) return NOT_ANSWERED;
  const answer = (question.answer ?? "").trim();
  /*
    `answered: true` with nothing in `answer` is a response disagreeing with
    itself. Shown as unanswered rather than as an empty line, because a blank
    under a question reads as an answer somebody gave.
  */
  return answer === "" ? NOT_ANSWERED : answer;
}

/** Whatever the API sent, narrowed. Questions keep the order they arrive in. */
export function toQuestions(
  raw: readonly {
    questionId?: string;
    text?: string;
    answered?: boolean;
    answer?: string;
    current?: boolean;
  }[] = [],
): PartyQuestion[] {
  return raw
    .filter((q) => typeof q.text === "string" && q.text !== "")
    .map((q) => ({
      questionId: q.questionId ?? q.text!,
      text: q.text!,
      answered: q.answered === true,
      ...(typeof q.answer === "string" ? { answer: q.answer } : {}),
      /*
        Absent `current` is read as `true`. `false` means "the listing no longer
        asks this", which is a claim worth making only when the server makes it;
        defaulting the other way would mark every question on an older response
        as withdrawn.
      */
      current: q.current !== false,
    }));
}

/**
 * Whether this booking can still be cancelled from the portal.
 *
 * "Only a booking that is still on (`confirmed` or `paid_pending_ops`), on a
 * departure that has not left." Both halves are checked here so the control is
 * withheld rather than offered and refused — the same call the capacity ceiling
 * and the team screen make. The action still handles every `409`, because a
 * departure leaves while somebody is looking at the screen.
 */
export function canCancelBooking(
  state: string,
  startsAt: string | undefined,
  now: number,
): boolean {
  if (state !== "confirmed" && state !== "paid_pending_ops") return false;
  if (!startsAt) return false;
  const departs = new Date(startsAt).getTime();
  if (Number.isNaN(departs)) return false;
  return departs > now;
}

/**
 * Whether the cash this business took is still theirs to hand back.
 *
 * Only on a CANCELLED booking whose cash was recorded as taken and not yet
 * recorded as given back. Drawing it any earlier puts "I gave the cash back"
 * under the thumb of somebody running a trip that is still on.
 */
export function canReturnCash(
  state: string,
  cash: { collected?: boolean; returnedAt?: string } | undefined,
): boolean {
  if (state !== "cancelled") return false;
  return cash?.collected === true && !cash.returnedAt;
}
