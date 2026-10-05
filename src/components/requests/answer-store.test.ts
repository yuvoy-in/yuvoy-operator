import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestView } from "@/lib/day/request-view";
import {
  createAnswerStore,
  HOLD_MS,
  UNKNOWN_OUTCOME,
  type AnswerActions,
} from "./answer-store";
import { takeAnswersSent } from "./answered";

const VIEW: RequestView = {
  id: "req_1",
  name: "Reuben Mathai",
  firstName: "Reuben",
  guests: 3,
  title: "Reuben Mathai, 3 people",
  trip: "Snorkel trip · Tomorrow at 09:00",
  asked: "Asked 2 h ago · Answer by 07:20",
  clock: "1h 20m left",
  urgent: false,
  seats: "6 seats you can still give",
  short: false,
  preset: null,
  timezone: "Asia/Kolkata",
};

function actions(): AnswerActions & {
  accept: ReturnType<typeof vi.fn>;
  decline: ReturnType<typeof vi.fn>;
} {
  return {
    accept: vi.fn().mockResolvedValue({
      granted: true,
      receipt: "They are holding 3 seats and still have to pay.",
    }),
    decline: vi.fn().mockResolvedValue({}),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  // The marks are module state: none outlives its test.
  takeAnswersSent(Number.MAX_SAFE_INTEGER);
});

/*
  Neither answer can be taken back once the API has it, so the Undo runs
  before the write: five seconds held, then sent (operator experiment A).
*/
describe("an answer held for five seconds", () => {
  it("sends nothing until the five seconds are up, then sends and keeps the receipt", async () => {
    const api = actions();
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    expect(store.get().req_1).toMatchObject({ phase: "holding" });

    await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
    expect(api.accept).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(api.accept).toHaveBeenCalledTimes(1);
    const form = api.accept.mock.calls[0][1] as FormData;
    expect(form.get("requestId")).toBe("req_1");
    expect(form.get("timezone")).toBe("Asia/Kolkata");
    expect(store.get().req_1).toMatchObject({
      phase: "granted",
      receipt: {
        contactName: "Reuben Mathai",
        guests: 3,
        sentence: "They are holding 3 seats and still have to pay.",
      },
    });
  });

  it("takes it back on Undo, and nothing is ever sent", async () => {
    const api = actions();
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.undo("req_1")).toBe(true);
    expect(store.get().req_1).toBeUndefined();
    await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
    expect(api.accept).not.toHaveBeenCalled();
  });

  it("cannot undo what has already gone", async () => {
    const api = actions();
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(store.undo("req_1")).toBe(false);
    expect(store.get().req_1).toMatchObject({ phase: "granted" });
  });

  it("sends a held answer at once when flushed, and only once", async () => {
    const api = actions();
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    store.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.accept).toHaveBeenCalledTimes(1);
    // The timer it replaced does not send it a second time.
    await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
    expect(api.accept).toHaveBeenCalledTimes(1);
  });

  it("treats a second tap on a sent answer as the same answer", async () => {
    const api = actions();
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(api.accept).toHaveBeenCalledTimes(1);
  });

  it("declines with the reason, and keeps the reason for the receipt", async () => {
    const api = actions();
    const store = createAnswerStore(api);
    store.hold("decline", VIEW, "weather");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    const form = api.decline.mock.calls[0][1] as FormData;
    expect(form.get("reasonCode")).toBe("weather");
    expect(store.get().req_1).toMatchObject({
      phase: "declined",
      reasonCode: "weather",
    });
  });

  it("says the API's refusal, and lets the request be answered again", async () => {
    const api = actions();
    api.accept.mockResolvedValue({
      message: "Already answered, or out of time. Refresh to see the queue.",
    });
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(store.get().req_1).toMatchObject({
      phase: "failed",
      message: "Already answered, or out of time. Refresh to see the queue.",
    });
    store.hold("decline", VIEW, "no_capacity");
    expect(store.get().req_1).toMatchObject({
      phase: "holding",
      kind: "decline",
    });
  });

  it("claims nothing when the action itself never answered", async () => {
    const api = actions();
    api.accept.mockRejectedValue(new Error("Failed to fetch"));
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(store.get().req_1).toMatchObject({
      phase: "failed",
      message: UNKNOWN_OUTCOME,
    });
  });

  it("re-reads the list once an answer settles", async () => {
    const api = actions();
    const store = createAnswerStore(api);
    const settled = vi.fn();
    store.onSettled(settled);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it("tells its listeners each step", async () => {
    const store = createAnswerStore(actions());
    const heard = vi.fn();
    const stop = store.subscribe(heard);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    // held, sending, granted
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    store.hold("accept", { ...VIEW, id: "req_2" });
    expect(heard).toHaveBeenCalledTimes(3);
  });
});

/*
  O02 A (approved 4 Oct 2026): "the Bookings count rolls down" when the
  operator answers, and only then. Each answer is marked just before it is
  sent, and one that did not go through takes its mark back.
*/
describe("the mark each answer leaves for the Bookings count", () => {
  it("is set before the answer is sent, for the fall that follows", async () => {
    const api = actions();
    let markedFirst = false;
    api.accept.mockImplementation(async () => {
      markedFirst = takeAnswersSent(0);
      return { granted: true };
    });
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(markedFirst).toBe(true);
  });

  it("is still there once an accept and a decline have gone through", async () => {
    const store = createAnswerStore(actions());
    store.hold("accept", VIEW);
    store.hold("decline", { ...VIEW, id: "req_2" }, "weather");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(takeAnswersSent(2)).toBe(true);
    expect(takeAnswersSent(1)).toBe(false);
  });

  it("is never set by an Undo, which sends nothing", async () => {
    const store = createAnswerStore(actions());
    store.hold("accept", VIEW);
    store.undo("req_1");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(takeAnswersSent(1)).toBe(false);
  });

  it("is taken back when the API refused the answer", async () => {
    const api = actions();
    api.decline.mockResolvedValue({ message: "Already answered." });
    const store = createAnswerStore(api);
    store.hold("decline", VIEW, "weather");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(takeAnswersSent(1)).toBe(false);
  });

  it("is taken back when nobody knows whether it went through", async () => {
    const api = actions();
    api.accept.mockRejectedValue(new Error("Failed to fetch"));
    const store = createAnswerStore(api);
    store.hold("accept", VIEW);
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(takeAnswersSent(1)).toBe(false);
  });
});
