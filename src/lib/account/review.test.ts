import { describe, expect, it } from "vitest";
import type { ChangeRequest } from "./change-kind";
import { reviewNote, reviewOf } from "./review";

const row = (over: Partial<ChangeRequest> = {}): ChangeRequest => ({
  id: "chg_1",
  kind: "logo",
  state: "pending",
  summary: "New logo",
  requestedAt: "2026-09-21T09:00:00Z",
  objectionUntil: null,
  coolingUntil: null,
  ...over,
});

describe("a logo or details change waiting on Yuvoy: yuvoy-operator#89", () => {
  it("says waiting while the newest change of the kind is pending", () => {
    expect(reviewOf([row()], "logo")).toEqual({
      state: "waiting",
      requestedAt: "2026-09-21T09:00:00Z",
    });
  });

  it("ignores other kinds, so a bank change never reads as a logo", () => {
    expect(reviewOf([row({ kind: "bank_account" })], "logo")).toBeNull();
    expect(reviewOf([row({ kind: "profile" })], "logo")).toBeNull();
    expect(reviewOf([row({ kind: "profile" })], "profile")?.state).toBe(
      "waiting",
    );
  });

  it("reads the NEWEST one, whatever order the list arrives in", () => {
    const decided = row({
      id: "old",
      state: "rejected",
      requestedAt: "2026-09-20T09:00:00Z",
    });
    const waiting = row({ id: "new", requestedAt: "2026-09-21T09:00:00Z" });
    expect(reviewOf([decided, waiting], "logo")?.state).toBe("waiting");
    expect(reviewOf([waiting, decided], "logo")?.state).toBe("waiting");
  });

  it("says refused when the newest was rejected", () => {
    expect(reviewOf([row({ state: "rejected" })], "logo")?.state).toBe(
      "refused",
    );
  });

  it("says nothing once it was applied, approved or withdrawn", () => {
    for (const state of ["applied", "approved", "withdrawn"] as const) {
      expect(reviewOf([row({ state })], "logo")).toBeNull();
    }
  });

  it("is history once the value on file is newer than the change", () => {
    /*
      A logo set directly after an earlier review (a business that is not LIVE
      any more) is newer news than that review, whatever state it is stuck in.
    */
    expect(reviewOf([row()], "logo", "2026-09-22T09:00:00Z")).toBeNull();
    expect(
      reviewOf([row({ state: "rejected" })], "logo", "2026-09-22T09:00:00Z"),
    ).toBeNull();
    // Older than the change: the change is still the news.
    expect(reviewOf([row()], "logo", "2026-09-01T09:00:00Z")?.state).toBe(
      "waiting",
    );
  });

  it("is nothing at all for an empty or failed read", () => {
    expect(reviewOf([], "logo")).toBeNull();
  });
});

describe("the note a screen shows", () => {
  it("writes the day it was sent in the market's calendar", () => {
    // 20:00 UTC is 01:30 the NEXT day in Kolkata.
    expect(
      reviewNote({ state: "waiting", requestedAt: "2026-09-21T20:00:00Z" }),
    ).toEqual({ state: "waiting", sentOn: "22 September 2026" });
  });

  it("says nothing about a day it was not told", () => {
    expect(reviewNote({ state: "refused", requestedAt: null })).toEqual({
      state: "refused",
      sentOn: null,
    });
    expect(reviewNote({ state: "refused", requestedAt: "soon" })?.sentOn).toBe(
      null,
    );
  });

  it("is nothing when there is nothing to say", () => {
    expect(reviewNote(null)).toBeNull();
  });
});
