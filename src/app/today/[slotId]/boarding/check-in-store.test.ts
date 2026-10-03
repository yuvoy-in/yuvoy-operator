import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCheckInStore,
  HOLD_MS,
  UNKNOWN_CHECK_IN,
} from "./check-in-store";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/*
  Arriving cannot be taken back on the API, so Aboard waits five seconds
  with an Undo before it is sent (operator experiment D).
*/
describe("a check-in, held five seconds", () => {
  it("sends `arrived` for this departure once the five seconds are up", async () => {
    const mark = vi.fn().mockResolvedValue({});
    const store = createCheckInStore("slot_dawn", mark);
    store.hold("bkg_1");
    await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
    expect(mark).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const form = mark.mock.calls[0][1] as FormData;
    expect([
      form.get("bookingId"),
      form.get("slotId"),
      form.get("outcome"),
    ]).toEqual(["bkg_1", "slot_dawn", "arrived"]);
    expect(store.get().bkg_1).toEqual({ phase: "sent" });
  });

  it("takes it back on Undo, and sends nothing", async () => {
    const mark = vi.fn().mockResolvedValue({});
    const store = createCheckInStore("slot_dawn", mark);
    store.hold("bkg_1");
    expect(store.undo("bkg_1")).toBe(true);
    await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
    expect(mark).not.toHaveBeenCalled();
    expect(store.get().bkg_1).toBeUndefined();
  });

  it("sends at once when flushed, and only once", async () => {
    const mark = vi.fn().mockResolvedValue({});
    const store = createCheckInStore("slot_dawn", mark);
    store.hold("bkg_1");
    store.hold("bkg_2");
    store.flush();
    await vi.advanceTimersByTimeAsync(HOLD_MS * 2);
    expect(mark).toHaveBeenCalledTimes(2);
  });

  it("says why, and lets it be tapped again, when nothing was recorded", async () => {
    const mark = vi
      .fn()
      .mockResolvedValueOnce({ message: "No signal. Nothing was recorded." })
      .mockResolvedValueOnce({});
    const store = createCheckInStore("slot_dawn", mark);
    store.hold("bkg_1");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(store.get().bkg_1).toEqual({
      phase: "failed",
      message: "No signal. Nothing was recorded.",
    });
    store.hold("bkg_1");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(store.get().bkg_1).toEqual({ phase: "sent" });
  });

  it("claims nothing when the send itself never answered", async () => {
    const mark = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const store = createCheckInStore("slot_dawn", mark);
    store.hold("bkg_1");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(store.get().bkg_1).toEqual({
      phase: "failed",
      message: UNKNOWN_CHECK_IN,
    });
  });

  it("is forgotten once the manifest shows the arrival, and not before it was sent", async () => {
    const mark = vi.fn().mockResolvedValue({});
    const store = createCheckInStore("slot_dawn", mark);
    const sent = vi.fn();
    store.onSent(sent);
    store.hold("bkg_1");
    // Still held: a re-read that already shows them must not cancel the send.
    store.settle("bkg_1");
    expect(store.get().bkg_1).toMatchObject({ phase: "holding" });
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(sent).toHaveBeenCalledWith("bkg_1");
    store.settle("bkg_1");
    expect(store.get().bkg_1).toBeUndefined();
  });

  it("does not send a second time for a second tap once it is on its way", async () => {
    const mark = vi.fn().mockResolvedValue({});
    const store = createCheckInStore("slot_dawn", mark);
    store.hold("bkg_1");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    store.hold("bkg_1");
    await vi.advanceTimersByTimeAsync(HOLD_MS);
    expect(mark).toHaveBeenCalledTimes(1);
  });
});
