import { describe, expect, it } from "vitest";
import {
  forgetSeatsSent,
  NOTE_KEPT_MS,
  noteSeatsSent,
  takeSeatsSent,
} from "./seats-sent";

/*
  The count "Set seats" sent, held until the board draws it, once (O08 A).
  Module state, never storage: a reload or a later re-read draws the board as
  it is, and nothing replays.
*/
describe("a seat count just sent", () => {
  it("is taken once, by the board that draws it", () => {
    noteSeatsSent("slot_a", 10, 1_000);
    expect(takeSeatsSent("slot_a", 10, 1_500)).toBe(true);
    expect(takeSeatsSent("slot_a", 10, 1_600)).toBe(false);
  });

  it("is not another count, nor another departure's", () => {
    noteSeatsSent("slot_b", 10, 1_000);
    expect(takeSeatsSent("slot_b", 9, 1_100)).toBe(false);
    expect(takeSeatsSent("slot_c", 10, 1_100)).toBe(false);
    // Still there for the count that was sent.
    expect(takeSeatsSent("slot_b", 10, 1_200)).toBe(true);
  });

  it("is forgotten when nothing takes it in time", () => {
    noteSeatsSent("slot_d", 10, 1_000);
    expect(takeSeatsSent("slot_d", 10, 1_001 + NOTE_KEPT_MS)).toBe(false);
    expect(takeSeatsSent("slot_d", 10, 1_002)).toBe(false);
  });

  it("is forgotten when the save is refused", () => {
    noteSeatsSent("slot_e", 10, 1_000);
    forgetSeatsSent("slot_e");
    expect(takeSeatsSent("slot_e", 10, 1_100)).toBe(false);
  });
});
