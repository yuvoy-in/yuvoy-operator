import { afterEach, describe, expect, it } from "vitest";
import {
  MARK_KEPT_MS,
  markAnswerSent,
  takeAnswersSent,
  unmarkAnswerSent,
} from "./answered";

/*
  The answers this operator just sent, until the Bookings count has shown
  them go (O02 A): module state, never storage, so a reload or a change made
  elsewhere never replays a roll.
*/
afterEach(() => {
  takeAnswersSent(Number.MAX_SAFE_INTEGER);
});

describe("an answer just sent", () => {
  it("is taken once, by the count's next fall", () => {
    markAnswerSent(1_000);
    expect(takeAnswersSent(1, 1_500)).toBe(true);
    expect(takeAnswersSent(1, 1_600)).toBe(false);
  });

  it("is nothing to a fall when no answer was sent", () => {
    expect(takeAnswersSent(1, 1_000)).toBe(false);
  });

  it("covers as many answers as the count fell by, and leaves the rest", () => {
    markAnswerSent(1_000);
    markAnswerSent(1_100);
    markAnswerSent(1_200);
    // Two answers landed in one re-read.
    expect(takeAnswersSent(2, 1_500)).toBe(true);
    // The third has a fall of its own.
    expect(takeAnswersSent(1, 1_600)).toBe(true);
    expect(takeAnswersSent(1, 1_700)).toBe(false);
  });

  it("is taken back when the answer did not go through", () => {
    const mark = markAnswerSent(1_000);
    unmarkAnswerSent(mark);
    expect(takeAnswersSent(1, 1_100)).toBe(false);
  });

  it("is forgotten when no fall comes in time", () => {
    markAnswerSent(1_000);
    expect(takeAnswersSent(1, 1_001 + MARK_KEPT_MS)).toBe(false);
  });
});
