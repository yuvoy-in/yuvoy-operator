import type { AttendanceState } from "../actions";

/**
 * Check-ins held for five seconds before they leave the phone.
 *
 * Arriving cannot be taken back: the API has no "not arrived after all",
 * and a wet thumb that ticks the wrong family has said something about
 * people who are still on the jetty. So "Aboard" moves the row at once and
 * waits five seconds with an Undo before `POST /bookings/{id}/attendance`
 * (operator experiment D: "a checked-in party sinks into Aboard with
 * Undo"). The same shape as a request's answer (`answer-store.ts`): leaving
 * the screen or hiding the page sends what is held, and nothing is said to
 * be done until the API has answered.
 *
 * Arriving is idempotent on the API ("a second tap keeps the first arrival
 * time"), so a send that failed for want of signal is safe to tap again.
 */

export const HOLD_MS = 5_000;

export type CheckIn =
  | { phase: "holding"; until: number }
  | { phase: "sending" }
  /** The API has it; the row stays aboard until the manifest re-reads. */
  | { phase: "sent" }
  | { phase: "failed"; message: string };

export type MarkAttendance = (
  prev: AttendanceState,
  form: FormData,
) => Promise<AttendanceState>;

export interface CheckInStore {
  get(): Readonly<Record<string, CheckIn>>;
  subscribe(listener: () => void): () => void;
  hold(bookingId: string): void;
  undo(bookingId: string): boolean;
  /** Forget an answered check-in once the manifest shows it. */
  settle(bookingId: string): void;
  flush(): void;
  onSent(listener: ((bookingId: string) => void) | null): void;
}

/** What a send that never got an answer says. */
export const UNKNOWN_CHECK_IN =
  "The connection dropped, so we cannot tell whether that was recorded. Tap Aboard again: a second tap is safe.";

export function createCheckInStore(
  slotId: string,
  mark: MarkAttendance,
  clock: () => number = () => Date.now(),
): CheckInStore {
  let state: Record<string, CheckIn> = {};
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let sent: ((bookingId: string) => void) | null = null;

  function set(id: string, next: CheckIn | null) {
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
    if (state[id]?.phase !== "holding") return;
    stopTimer(id);
    set(id, { phase: "sending" });
    const form = new FormData();
    form.set("bookingId", id);
    form.set("slotId", slotId);
    form.set("outcome", "arrived");
    try {
      const answer = await mark({}, form);
      if (answer.message) {
        set(id, { phase: "failed", message: answer.message });
        return;
      }
      // Kept until the re-read manifest says arrived: see `settle`.
      set(id, { phase: "sent" });
      sent?.(id);
    } catch {
      set(id, { phase: "failed", message: UNKNOWN_CHECK_IN });
    }
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hold(id) {
      const phase = state[id]?.phase;
      if (!id || phase === "sending" || phase === "sent") return;
      stopTimer(id);
      set(id, { phase: "holding", until: clock() + HOLD_MS });
      timers.set(
        id,
        setTimeout(() => void send(id), HOLD_MS),
      );
    },
    undo(id) {
      if (state[id]?.phase !== "holding") return false;
      stopTimer(id);
      set(id, null);
      return true;
    },
    settle(id) {
      const phase = state[id]?.phase;
      if (phase === "sent" || phase === "failed") set(id, null);
    },
    flush() {
      for (const [id, entry] of Object.entries(state)) {
        if (entry.phase === "holding") void send(id);
      }
    },
    onSent(listener) {
      sent = listener;
    },
  };
}
