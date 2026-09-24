import { beforeEach, describe, expect, it, vi } from "vitest";

/*
  Counter sales on the calendar's departures (yuvoy-api#226, op#89 f12).

  `soldOffline` is already taken off `seats`, so a six-seat departure with two
  walk-ups reads "0 of 4 sold · 4 left". The count is what names the two
  people; without it the next visit after the receipt could not say why six
  became four.
*/

const get = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: get }),
}));

const { listSlots } = await import("./manifest");

function departure(over: Record<string, unknown>) {
  return {
    id: "slot_1",
    experienceId: "exp_1",
    title: "Reef dive",
    startsAt: "2026-09-24T03:30:00Z",
    timezone: "Asia/Kolkata",
    seats: 4,
    sold: 0,
    remaining: 4,
    status: "open",
    ...over,
  };
}

function answer(items: Record<string, unknown>[]) {
  return { data: { items, complete: true }, error: undefined };
}

beforeEach(() => get.mockReset());

describe("a departure's counter sales", () => {
  it("carries the count the API sent", async () => {
    get.mockResolvedValueOnce(answer([departure({ soldOffline: 2 })]));
    const [slot] = await listSlots("tok", "2026-09-24", "2026-09-24");
    expect(slot.soldOffline).toBe(2);
    // Already taken off the seats: nothing is added back or subtracted again.
    expect(slot.seats).toBe(4);
    expect(slot.remaining).toBe(4);
  });

  it("says nothing when there were none", async () => {
    get.mockResolvedValueOnce(answer([departure({ soldOffline: 0 })]));
    const [slot] = await listSlots("tok", "2026-09-24", "2026-09-24");
    expect(slot).not.toHaveProperty("soldOffline");
  });

  it("says nothing against an API older than 2afd7b4, which sends no count", async () => {
    get.mockResolvedValueOnce(answer([departure({})]));
    const [slot] = await listSlots("tok", "2026-09-24", "2026-09-24");
    expect(slot).not.toHaveProperty("soldOffline");
  });

  it("does not turn something that is not a count into people at the counter", async () => {
    get.mockResolvedValueOnce(
      answer([
        departure({ id: "a", soldOffline: "2" }),
        departure({ id: "b", soldOffline: 1.5 }),
        departure({ id: "c", soldOffline: -1 }),
      ]),
    );
    const slots = await listSlots("tok", "2026-09-24", "2026-09-24");
    for (const slot of slots) expect(slot).not.toHaveProperty("soldOffline");
  });
});
