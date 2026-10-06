import type { RequestActionState } from "@/app/bookings/actions";
import type { DeclineReason } from "@/lib/day/request-types";
import type { RequestView } from "@/lib/day/request-view";
import { markAnswerSent, unmarkAnswerSent } from "./answered";

/**
 * Answers to seat requests, held for five seconds before they leave the phone.
 *
 * ## Why hold at all
 *
 * Neither answer can be taken back once the API has it. An accept tells the
 * traveller at once and starts their twelve hours to pay; a decline sends
 * them the reason. The contract has no un-accept and no un-decline, so the
 * only Undo there can be is one that runs BEFORE the write: the card becomes
 * a row saying what is about to happen, with Undo, and the Server Action is
 * called when the five seconds are up (operator experiment A, approved
 * 3 Oct 2026). Nothing about the API changes.
 *
 * ## Never lost, never claimed
 *
 * A held answer is the operator's decision, so leaving the screen does not
 * cancel it: unmounting, and the page being hidden (a phone locked, the app
 * switched to tell the traveller), send every held answer at once
 * (`flush`). And nothing is said to be done until the API has answered: the
 * receipt is drawn from the answer, never from the tap.
 *
 * Kept outside React (a tiny store read through `useSyncExternalStore`) so a
 * timer and a page-hide listener both see the current answers, and so the
 * whole life of an answer is tested without rendering anything.
 *
 * ## The count it lowers rolls down (O02 A, approved 4 Oct 2026)
 *
 * Each answer is marked just before it is sent (`markAnswerSent`), so the
 * Bookings count rolls down when the re-read lowers it, rather than
 * cross-fading as it does for a request answered elsewhere. An answer that
 * did not go through takes its mark back.
 */

/** How long an answer waits for an Undo. */
export const HOLD_MS = 5_000;

export type AnswerKind = "accept" | "decline";

/** What an accept produced, for the receipt. */
export interface Receipt {
  id: string;
  contactName: string;
  guests: number;
  /** The API's whole sentence, when it sent one (yuvoy-api#203). */
  sentence?: string;
  /** "14:41", or "08:00 on Tue 22 Sep": for a response with no sentence. */
  payBy?: string;
  /** Nothing could carry the news, so the traveller does not know yet. */
  untold?: boolean;
}

interface Base {
  view: RequestView;
  kind: AnswerKind;
  reasonCode?: DeclineReason;
}

export type Answer =
  | (Base & { phase: "holding"; until: number })
  | (Base & { phase: "sending" })
  | (Base & { phase: "granted"; receipt: Receipt })
  | (Base & { phase: "declined" })
  | (Base & { phase: "failed"; message: string; seeBusiness?: boolean });

/** The two Server Actions, injected so a test can stand in for the API. */
export interface AnswerActions {
  accept: (
    prev: RequestActionState,
    form: FormData,
  ) => Promise<RequestActionState>;
  decline: (
    prev: RequestActionState,
    form: FormData,
  ) => Promise<RequestActionState>;
}

export interface AnswerStore {
  get(): Readonly<Record<string, Answer>>;
  subscribe(listener: () => void): () => void;
  /** Hold an answer. A second answer to the same request replaces the first. */
  hold(kind: AnswerKind, view: RequestView, reasonCode?: DeclineReason): void;
  /** Take a held answer back. Nothing was sent; the card is offered again. */
  undo(id: string): boolean;
  /** Forget a failed answer, so its card is offered on its own again. */
  dismiss(id: string): void;
  /** Send every held answer now. */
  flush(): void;
  /** Called once each answer settles, to re-read the list beneath. */
  onSettled(listener: (() => void) | null): void;
}

/**
 * The sentence for a Server Action that threw rather than answered: a
 * deploy mid-tap, or the connection to this site dropping. Whether the API
 * got it is not known here, so it is not claimed either way.
 */
export const UNKNOWN_OUTCOME =
  "The connection dropped, so we cannot tell whether that went through. Refresh to see the queue.";

export function createAnswerStore(
  actions: AnswerActions,
  clock: () => number = () => Date.now(),
): AnswerStore {
  let state: Record<string, Answer> = {};
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let settled: (() => void) | null = null;

  function set(id: string, next: Answer | null) {
    const copy = { ...state };
    if (next) copy[id] = next;
    else delete copy[id];
    state = copy;
    listeners.forEach((listener) => listener());
  }

  function stopTimer(id: string) {
    const timer = timers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    timers.delete(id);
  }

  async function send(id: string) {
    const held = state[id];
    if (!held || held.phase !== "holding") return;
    stopTimer(id);
    const { view, kind, reasonCode } = held;
    set(id, { view, kind, reasonCode, phase: "sending" });

    const form = new FormData();
    form.set("requestId", id);
    form.set("timezone", view.timezone);
    if (kind === "decline" && reasonCode) {
      form.set("intent", "decline");
      form.set("reasonCode", reasonCode);
    }

    let next: Answer;
    const mark = markAnswerSent();
    try {
      const answer =
        kind === "accept"
          ? await actions.accept({}, form)
          : await actions.decline({}, form);
      if (kind === "accept" && answer.granted) {
        next = {
          view,
          kind,
          phase: "granted",
          receipt: {
            id,
            contactName: view.name,
            guests: view.guests,
            ...(answer.receipt ? { sentence: answer.receipt } : {}),
            ...(answer.payBy ? { payBy: answer.payBy } : {}),
            ...(answer.untold ? { untold: true } : {}),
          },
        };
      } else if (kind === "decline" && !answer.message) {
        next = { view, kind, reasonCode, phase: "declined" };
      } else {
        next = {
          view,
          kind,
          reasonCode,
          phase: "failed",
          message:
            answer.message ??
            `Could not ${kind}. Nothing was sent. The request is still open.`,
          ...(answer.seeBusiness ? { seeBusiness: true } : {}),
        };
      }
    } catch {
      next = {
        view,
        kind,
        reasonCode,
        phase: "failed",
        message: UNKNOWN_OUTCOME,
      };
    }
    // Refused, or not known to have landed: whatever the count does next
    // was not seen to be this answer.
    if (next.phase === "failed") unmarkAnswerSent(mark);
    set(id, next);
    /*
      A decline that landed has been re-read already: `declineRequest`
      revalidates, and its answer carries the list without the request.
      Asking again rendered the screen twice (production readiness, 6 Oct
      2026). An accept does not revalidate, and a refusal usually means the
      queue moved somewhere else (answered on another phone, or lapsed), so
      for those the list beneath is read again.
    */
    if (next.phase !== "declined") settled?.();
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hold(kind, view, reasonCode) {
      const id = view.id;
      if (!id) return;
      const was = state[id];
      // Already on its way, or done: a second tap is not a second answer.
      if (
        was &&
        (was.phase === "sending" ||
          was.phase === "granted" ||
          was.phase === "declined")
      ) {
        return;
      }
      stopTimer(id);
      set(id, {
        view,
        kind,
        reasonCode,
        phase: "holding",
        until: clock() + HOLD_MS,
      });
      timers.set(
        id,
        setTimeout(() => void send(id), HOLD_MS),
      );
    },
    undo(id) {
      const held = state[id];
      if (!held || held.phase !== "holding") return false;
      stopTimer(id);
      set(id, null);
      return true;
    },
    dismiss(id) {
      if (state[id]?.phase === "failed") set(id, null);
    },
    flush() {
      for (const [id, answer] of Object.entries(state)) {
        if (answer.phase === "holding") void send(id);
      }
    },
    onSettled(listener) {
      settled = listener;
    },
  };
}
