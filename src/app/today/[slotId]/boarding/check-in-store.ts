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
 * time"), so a check-in that cannot be sent is kept on the phone instead and
 * sent when the signal is back (`keep`, `lib/site/offline-writes.ts`): with
 * no signal when the five seconds are up, or when the send never came back.
 * The phone's list of kept writes then owns it, not this store.
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
  /** How to keep a check-in that cannot be sent. Unset, it fails instead. */
  onKeep(keep: KeepCheckIn | null): void;
}

/** What a send that never got an answer says. */
export const UNKNOWN_CHECK_IN =
  "The connection dropped, so we cannot tell whether that was recorded. Tap Aboard again: a second tap is safe.";

/**
 * Keeps a check-in on the phone to send later. `false` when it cannot be kept
 * (nobody is signed in that the phone knows of), and the row then says so.
 */
export type KeepCheckIn = (bookingId: string, tappedAt: number) => boolean;

export function createCheckInStore(
  slotId: string,
  mark: MarkAttendance,
  clock: () => number = () => Date.now(),
  isOnline: () => boolean = () => navigator.onLine,
): CheckInStore {
  let keep: KeepCheckIn = () => false;
  let state: Record<string, CheckIn> = {};
  const listeners = new Set<() => void>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const tapped = new Map<string, number>();

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

  /**
   * Hands a check-in to the phone's kept writes, then lets go of it here. In
   * that order, so the row is never in neither list for a render.
   */
  function keepOrFail(id: string, message: string) {
    if (keep(id, tapped.get(id) ?? clock())) {
      tapped.delete(id);
      set(id, null);
      return;
    }
    set(id, { phase: "failed", message });
  }

  async function send(id: string) {
    if (state[id]?.phase !== "holding") return;
    stopTimer(id);
    if (!isOnline()) {
      keepOrFail(id, "No signal. Nothing was recorded.");
      return;
    }
    set(id, { phase: "sending" });
    const form = new FormData();
    form.set("bookingId", id);
    form.set("slotId", slotId);
    form.set("outcome", "arrived");
    // When they were seen, not when the five seconds ran out (yuvoy-api#263).
    form.set("seenAt", new Date(tapped.get(id) ?? clock()).toISOString());
    try {
      const answer = await mark({}, form);
      if (answer.retryable) {
        keepOrFail(id, answer.message ?? UNKNOWN_CHECK_IN);
        return;
      }
      if (answer.message) {
        set(id, { phase: "failed", message: answer.message });
        return;
      }
      /*
        Kept until the re-read manifest says arrived: see `settle`. Nothing
        asks for that read: `markAttendance` revalidates, so the answer it
        came back with already carries the manifest.
      */
      tapped.delete(id);
      set(id, { phase: "sent" });
    } catch {
      // It may or may not have reached the API; arriving twice is safe.
      keepOrFail(id, UNKNOWN_CHECK_IN);
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
      const now = clock();
      /*
        Tapped again after a send that failed: they were seen at the FIRST
        tap, and that is the time sent. A row Undo cleared starts fresh.
      */
      if (phase !== "failed" || !tapped.has(id)) tapped.set(id, now);
      set(id, { phase: "holding", until: now + HOLD_MS });
      timers.set(
        id,
        setTimeout(() => void send(id), HOLD_MS),
      );
    },
    undo(id) {
      if (state[id]?.phase !== "holding") return false;
      stopTimer(id);
      tapped.delete(id);
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
    onKeep(next) {
      keep = next ?? (() => false);
    },
  };
}
