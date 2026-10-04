import { formatPaise } from "@/lib/format/money";
import { marketTime } from "@/lib/format/market-time";

/**
 * What this phone keeps to send when the signal comes back (boarding mode,
 * operator experiment D, approved 3 Oct 2026: "actions taken offline are kept
 * on the phone and sent when the signal returns, with a quiet strip that never
 * lies").
 *
 * ## Only the two writes that are safe to send twice
 *
 * Checking a party in (`arrived`) and recording the cash they paid. The API
 * makes both idempotent: a second check-in keeps the first arrival time, and a
 * second cash report answers the first one, `alreadyRecorded`, without ever
 * restating the amount. So a write that may or may not have reached the API
 * before the signal went can simply be sent again. Closing a party out,
 * messages and cancelling are not, and they wait for the signal.
 *
 * ## Whose they are
 *
 * Each write carries the id of the person signed in when it was made, and is
 * only ever sent while that same person is signed in, so a phone handed to a
 * colleague never sends one person's check-ins as another's. Signing out
 * keeps them; they go the next time that person signs in on this phone.
 *
 * ## For a day, then said and dropped
 *
 * A write older than a day is not sent: a check-in recorded days later is a
 * wrong arrival time on somebody's trip. It is dropped, and the drop is said.
 *
 * ## Ids, amounts and times, and nothing else (owner ruling, 4 Oct 2026)
 *
 * Kept in `localStorage`, so a check-in survives the phone closing the app at
 * the jetty, which iPhones do to a tab in the background. That is the
 * portal's second exception to its localStorage ban (the first is the upload
 * slot), and it is narrow: the booking, the departure and the person as
 * opaque ids, the amount and the time. No names, no reference, nothing that
 * signs in or pays: the screens supply the names, and `scripts/qa.mjs` fails
 * the build if a field like that is ever written here.
 *
 * Every read and write is guarded: private modes and full storage refuse it,
 * and then the writes live for this page only.
 */

export const STORAGE_KEY = "yuvoy-operator:offline-writes:v1";
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * How far before the tap an answer's time must be to have been somebody
 * else's. Phone and server clocks disagree by seconds, sometimes a minute.
 */
export const CLOCK_SLACK_MS = 2 * 60 * 1000;

interface WriteBase {
  /** One of each kind per booking: `arrived:bkg_1`, `cash:bkg_1`. */
  key: string;
  userId: string;
  slotId: string;
  bookingId: string;
  /** When it was tapped, on this phone's clock. */
  at: number;
}

export interface ArrivedWrite extends WriteBase {
  kind: "arrived";
}

export interface CashWrite extends WriteBase {
  kind: "cash";
  /** `fare` sends no amount: the server knows the fare. */
  mode: "fare" | "less";
  /** What the strip adds up; `null` when the fare was not known here. */
  amountPaise: number | null;
  /** The rupees typed, sent as typed, for `less`. */
  amount: string;
}

export type OfflineWrite = ArrivedWrite | CashWrite;
export type NewWrite = Omit<ArrivedWrite, "key"> | Omit<CashWrite, "key">;

/** What became of a write once it was sent, or dropped. */
export interface WriteOutcome {
  key: string;
  kind: OfflineWrite["kind"];
  slotId: string;
  bookingId: string;
  /** When it was answered, on this phone's clock. */
  answeredAt: number;
  /** Which send it came from, so a screen says only the latest. */
  batch: number;
  result: "sent" | "refused" | "expired";
  /**
   * Somebody had already done it, before this phone's tap: the time the API
   * holds, and for cash the amount it holds.
   */
  earlier?: { at: string; collectedPaise?: number };
  /** The API's or the action's sentence, for a refusal. */
  message?: string;
}

const EMPTY: readonly OfflineWrite[] = Object.freeze([]);
const NO_OUTCOMES: readonly WriteOutcome[] = Object.freeze([]);

export function writeKey(
  kind: OfflineWrite["kind"],
  bookingId: string,
): string {
  return `${kind}:${bookingId}`;
}

function isWrite(value: unknown): value is OfflineWrite {
  if (!value || typeof value !== "object") return false;
  const w = value as Record<string, unknown>;
  const base =
    typeof w.key === "string" &&
    typeof w.userId === "string" &&
    w.userId !== "" &&
    typeof w.slotId === "string" &&
    typeof w.bookingId === "string" &&
    w.bookingId !== "" &&
    typeof w.at === "number" &&
    Number.isFinite(w.at);
  if (!base) return false;
  if (w.kind === "arrived") return true;
  return (
    w.kind === "cash" &&
    (w.mode === "fare" || w.mode === "less") &&
    (w.amountPaise === null || typeof w.amountPaise === "number") &&
    typeof w.amount === "string"
  );
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readStored(): OfflineWrite[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isWrite) : [];
  } catch {
    return [];
  }
}

function writeStored(list: readonly OfflineWrite[]) {
  const store = storage();
  if (!store) return;
  try {
    if (list.length === 0) store.removeItem(STORAGE_KEY);
    else store.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* Refused (private mode, full): kept in memory for this page only. */
  }
}

let cache: readonly OfflineWrite[] | null = null;
let outcomes: readonly WriteOutcome[] = NO_OUTCOMES;
const listeners = new Set<() => void>();

function load(): readonly OfflineWrite[] {
  if (typeof window === "undefined") return EMPTY;
  if (cache === null) cache = readStored();
  return cache;
}

function emit() {
  listeners.forEach((listener) => listener());
}

/** Another tab sent or kept something: re-read, so this one agrees. */
function onStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== STORAGE_KEY) return;
  cache = readStored();
  emit();
}

export const offlineWrites = {
  /** Every write kept on this phone, oldest first. Stable until it changes. */
  list(): readonly OfflineWrite[] {
    return load();
  },
  /** What the server snapshot is: nothing, because the server keeps nothing. */
  serverList(): readonly OfflineWrite[] {
    return EMPTY;
  },
  /** What became of the writes sent from this page, newest last. */
  outcomes(): readonly WriteOutcome[] {
    return outcomes;
  },
  serverOutcomes(): readonly WriteOutcome[] {
    return NO_OUTCOMES;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (listeners.size === 1) window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        window.removeEventListener("storage", onStorage);
      }
    };
  },
  /**
   * Keeps a write to send later. A second one for the same booking and kind
   * changes nothing: the first tap is the one that happened first.
   */
  add(write: NewWrite): void {
    const key = writeKey(write.kind, write.bookingId);
    const list = load();
    if (list.some((w) => w.key === key)) return;
    cache = [...list, { ...write, key } as OfflineWrite];
    writeStored(cache);
    emit();
  },
  remove(key: string): void {
    const list = load();
    if (!list.some((w) => w.key === key)) return;
    cache = list.filter((w) => w.key !== key);
    writeStored(cache);
    emit();
  },
  record(outcome: WriteOutcome): void {
    outcomes = [...outcomes.slice(-19), outcome];
    emit();
  },
  /**
   * For tests: forget what this page holds in memory, as a reload would.
   * What is in storage stays, and is read back on the next look.
   */
  reset(): void {
    cache = null;
    outcomes = NO_OUTCOMES;
    emit();
  },
  /** For tests: forget everything, in memory and in storage. */
  forget(): void {
    cache = [];
    writeStored(cache);
    outcomes = NO_OUTCOMES;
    emit();
  },
};

/** This person's writes, for one departure when one is named. */
export function writesFor(
  list: readonly OfflineWrite[],
  userId: string | undefined,
  slotId?: string,
): OfflineWrite[] {
  if (!userId) return [];
  return list.filter(
    (w) => w.userId === userId && (slotId === undefined || w.slotId === slotId),
  );
}

/**
 * "3 check-ins and ₹9,000 taken": what is kept, and how many things that is.
 * `null` for none.
 */
export function savedItems(
  writes: readonly OfflineWrite[],
): { phrase: string; count: number } | null {
  const checkIns = writes.filter((w) => w.kind === "arrived").length;
  const cash = writes.filter((w): w is CashWrite => w.kind === "cash");
  const parts: string[] = [];
  if (checkIns > 0) {
    parts.push(checkIns === 1 ? "1 check-in" : `${checkIns} check-ins`);
  }
  if (cash.length > 0) {
    const known = cash.every((w) => w.amountPaise !== null);
    if (known) {
      const total = cash.reduce((sum, w) => sum + (w.amountPaise ?? 0), 0);
      parts.push(`${formatPaise(total)} taken`);
    } else {
      parts.push(
        cash.length === 1
          ? "cash from 1 party"
          : `cash from ${cash.length} parties`,
      );
    }
  }
  if (parts.length === 0) return null;
  return { phrase: parts.join(" and "), count: checkIns + cash.length };
}

/** "3 check-ins and ₹9,000 taken are saved on this phone." `null` for none. */
export function savedLine(writes: readonly OfflineWrite[]): string | null {
  const items = savedItems(writes);
  if (!items) return null;
  return `${items.phrase} ${items.count === 1 ? "is" : "are"} saved on this phone.`;
}

/**
 * What an outcome says, in the market's clock, with the party's name from the
 * screen (nothing kept on the phone carries one). A plain send says nothing
 * of its own: "Sent at 06:41" is said once for the batch.
 */
export function outcomeLine(
  outcome: WriteOutcome,
  timezone: string,
  nameOf: (bookingId: string) => string,
): string | null {
  const name = nameOf(outcome.bookingId);
  if (outcome.result === "expired") {
    return outcome.kind === "arrived"
      ? `${name}'s check-in was saved on this phone over a day ago and was not sent.`
      : `The cash from ${name} was saved on this phone over a day ago and was not sent. Record it again if it is still right.`;
  }
  if (outcome.result === "refused") {
    const what =
      outcome.kind === "arrived" ? "Not checked in" : "Cash not recorded";
    return `${name}: ${what}. ${outcome.message ?? "Try again."}`;
  }
  if (!outcome.earlier) return null;
  const when = marketTime(outcome.earlier.at, timezone);
  if (outcome.kind === "arrived") {
    return `${name} was already checked in at ${when}.`;
  }
  const amount = outcome.earlier.collectedPaise;
  return amount === undefined
    ? `The cash from ${name} was already recorded at ${when}.`
    : `The cash from ${name} was already recorded at ${when}: ${formatPaise(amount)}.`;
}

/** Whether the API's time is before this phone's tap, by more than slack. */
export function wasEarlier(
  apiTime: string | undefined,
  tappedAt: number,
): boolean {
  if (!apiTime) return false;
  const at = Date.parse(apiTime);
  return Number.isFinite(at) && at < tappedAt - CLOCK_SLACK_MS;
}

/** What sending one write came to. */
export type SendAnswer =
  | { kind: "sent"; earlier?: WriteOutcome["earlier"] }
  /** Not reached, or not answered: keep it and try again. */
  | { kind: "retry" }
  | { kind: "refused"; message: string };

export interface Senders {
  arrived(write: ArrivedWrite): Promise<SendAnswer>;
  cash(write: CashWrite): Promise<SendAnswer>;
}

let replaying = false;
let batches = 0;

/** The outcomes of the latest send that touched this departure. */
export function lastBatchFor(
  list: readonly WriteOutcome[],
  slotId: string,
): WriteOutcome[] {
  const mine = list.filter((o) => o.slotId === slotId);
  if (mine.length === 0) return [];
  const batch = Math.max(...mine.map((o) => o.batch));
  return mine.filter((o) => o.batch === batch);
}

/**
 * Sends this person's kept writes, oldest first, one at a time on one bar.
 * Stops at the first that could not be sent: the signal has gone again, and
 * the rest wait with it. Never two batches at once.
 */
export async function replayWrites(
  userId: string,
  senders: Senders,
  now: () => number = () => Date.now(),
): Promise<{ sent: number; left: number }> {
  if (replaying) return { sent: 0, left: -1 };
  replaying = true;
  const batch = (batches += 1);
  let sent = 0;
  try {
    const queue = writesFor(offlineWrites.list(), userId).sort(
      (a, b) => a.at - b.at,
    );
    for (const write of queue) {
      const base = {
        key: write.key,
        kind: write.kind,
        slotId: write.slotId,
        bookingId: write.bookingId,
        batch,
      };
      if (now() - write.at > MAX_AGE_MS) {
        offlineWrites.remove(write.key);
        offlineWrites.record({ ...base, answeredAt: now(), result: "expired" });
        continue;
      }
      const answer =
        write.kind === "arrived"
          ? await senders.arrived(write)
          : await senders.cash(write);
      if (answer.kind === "retry") break;
      offlineWrites.remove(write.key);
      if (answer.kind === "refused") {
        offlineWrites.record({
          ...base,
          answeredAt: now(),
          result: "refused",
          message: answer.message,
        });
        continue;
      }
      sent += 1;
      offlineWrites.record({
        ...base,
        answeredAt: now(),
        result: "sent",
        ...(answer.earlier ? { earlier: answer.earlier } : {}),
      });
    }
  } finally {
    replaying = false;
  }
  return { sent, left: writesFor(offlineWrites.list(), userId).length };
}
