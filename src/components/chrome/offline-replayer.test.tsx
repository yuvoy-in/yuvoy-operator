import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import type { ArrivedWrite, CashWrite } from "@/lib/site/offline-writes";

const refresh = vi.fn();
const markAttendance = vi.fn();
const recordCashCollected = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/today/[slotId]/actions", () => ({
  markAttendance: (prev: unknown, form: FormData) => markAttendance(prev, form),
}));
vi.mock("@/app/bookings/cash-actions", () => ({
  recordCashCollected: (prev: unknown, form: FormData) =>
    recordCashCollected(prev, form),
}));

const { OfflineReplayer, senders } = await import("./offline-replayer");
const { ChromeProvider } = await import("./chrome-context");
const { offlineWrites } = await import("@/lib/site/offline-writes");

const TAPPED = Date.parse("2026-10-04T01:00:00Z");

const ARRIVED: ArrivedWrite = {
  kind: "arrived",
  key: "arrived:bkg_asha",
  userId: "usr_owner",
  slotId: "slot_dawn",
  bookingId: "bkg_asha",
  at: TAPPED,
};
const CASH: CashWrite = {
  kind: "cash",
  key: "cash:bkg_asha",
  userId: "usr_owner",
  slotId: "slot_dawn",
  bookingId: "bkg_asha",
  at: TAPPED,
  mode: "less",
  amount: "8000",
  amountPaise: 800_000,
};

let online = true;

beforeEach(() => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  offlineWrites.forget();
});
afterEach(() => {
  vi.restoreAllMocks();
  refresh.mockReset();
  markAttendance.mockReset();
  recordCashCollected.mockReset();
});

/*
  Sending what was kept on the phone (boarding mode, operator experiment D):
  each server action's answer read back into sent, keep, or refused.
*/
describe("sending a kept check-in", () => {
  it("sends `arrived` for its departure", async () => {
    markAttendance.mockResolvedValue({});
    expect(await senders.arrived(ARRIVED)).toEqual({ kind: "sent" });
    const form = markAttendance.mock.calls[0][1] as FormData;
    expect([
      form.get("bookingId"),
      form.get("slotId"),
      form.get("outcome"),
    ]).toEqual(["bkg_asha", "slot_dawn", "arrived"]);
  });

  it("says when somebody had already checked them in, before this tap", async () => {
    markAttendance.mockResolvedValue({ arrivedAt: "2026-10-04T00:50:00Z" });
    expect(await senders.arrived(ARRIVED)).toEqual({
      kind: "sent",
      earlier: { at: "2026-10-04T00:50:00Z" },
    });
    // Its own earlier send, answered late, is not somebody else's.
    markAttendance.mockResolvedValue({ arrivedAt: "2026-10-04T01:00:20Z" });
    expect(await senders.arrived(ARRIVED)).toEqual({ kind: "sent" });
  });

  it("keeps it when the API could not be reached, or nothing came back", async () => {
    markAttendance.mockResolvedValue({
      message: "No signal.",
      retryable: true,
    });
    expect(await senders.arrived(ARRIVED)).toEqual({ kind: "retry" });
    markAttendance.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await senders.arrived(ARRIVED)).toEqual({ kind: "retry" });
  });

  it("lets it go with the reason when the API refuses it", async () => {
    markAttendance.mockResolvedValue({
      message: "Already settled. Refresh to see where it landed.",
    });
    expect(await senders.arrived(ARRIVED)).toEqual({
      kind: "refused",
      message: "Already settled. Refresh to see where it landed.",
    });
  });
});

describe("sending kept cash", () => {
  it("sends the amount typed, for an amount other than the fare", async () => {
    recordCashCollected.mockResolvedValue({
      recorded: {
        collectedPaise: 800_000,
        shortfallPaise: 100_000,
        collectedAt: "2026-10-04T01:05:00Z",
        alreadyRecorded: false,
      },
    });
    expect(await senders.cash(CASH)).toEqual({ kind: "sent" });
    const form = recordCashCollected.mock.calls[0][1] as FormData;
    expect([form.get("mode"), form.get("amount")]).toEqual(["less", "8000"]);
  });

  it("sends no amount for the whole fare", async () => {
    recordCashCollected.mockResolvedValue({
      recorded: {
        collectedPaise: 900_000,
        shortfallPaise: 0,
        collectedAt: "2026-10-04T01:05:00Z",
        alreadyRecorded: false,
      },
    });
    await senders.cash({ ...CASH, mode: "fare", amount: "" });
    const form = recordCashCollected.mock.calls[0][1] as FormData;
    expect([form.get("mode"), form.get("amount")]).toEqual(["fare", null]);
  });

  it("says what was already recorded from somewhere else, and how much", async () => {
    recordCashCollected.mockResolvedValue({
      recorded: {
        collectedPaise: 900_000,
        shortfallPaise: 0,
        collectedAt: "2026-10-04T00:40:00Z",
        alreadyRecorded: true,
      },
    });
    expect(await senders.cash(CASH)).toEqual({
      kind: "sent",
      earlier: { at: "2026-10-04T00:40:00Z", collectedPaise: 900_000 },
    });
  });

  it("keeps it, or lets it go with the reason, as for a check-in", async () => {
    recordCashCollected.mockResolvedValue({
      message: "No signal.",
      retryable: true,
    });
    expect(await senders.cash(CASH)).toEqual({ kind: "retry" });
    recordCashCollected.mockResolvedValue({
      message: "That is more than the fare.",
    });
    expect(await senders.cash(CASH)).toEqual({
      kind: "refused",
      message: "That is more than the fare.",
    });
  });
});

describe("the replayer in the chrome", () => {
  function mount(userId?: string) {
    return render(
      <ChromeProvider
        identity={{
          businessName: null,
          canManage: true,
          ...(userId ? { userId } : {}),
        }}
      >
        <OfflineReplayer />
      </ChromeProvider>,
    );
  }

  it("sends this person's kept writes as it mounts, then re-reads the screen", async () => {
    markAttendance.mockResolvedValue({});
    offlineWrites.add({ ...ARRIVED });
    mount("usr_owner");
    await act(async () => {});
    expect(markAttendance).toHaveBeenCalledTimes(1);
    expect(offlineWrites.list()).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("waits with no signal, and sends when the browser says it is back", async () => {
    markAttendance.mockResolvedValue({});
    online = false;
    offlineWrites.add({ ...ARRIVED });
    mount("usr_owner");
    await act(async () => {});
    expect(markAttendance).not.toHaveBeenCalled();

    online = true;
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    expect(markAttendance).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("never sends somebody else's, or anything while signed out", async () => {
    offlineWrites.add({ ...ARRIVED });
    const { unmount } = mount("usr_staff");
    await act(async () => {});
    unmount();
    mount();
    await act(async () => {});
    expect(markAttendance).not.toHaveBeenCalled();
    expect(offlineWrites.list()).toHaveLength(1);
  });
});
