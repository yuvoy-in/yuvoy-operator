import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";

/*
  The departure screen's writes, as the API now answers them (op#89, #90, #95).

  A relay counts the people it reaches and names the ones it could not; two
  refusals that read "Not sent. Try again." have their own sentences; and a
  call-off reports the cash it did not refund.
*/

const post = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me: { canManage: true } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { sendRelay, callOffDeparture } = await import("./actions");

function relayForm(over: Record<string, string> = {}): FormData {
  const f = new FormData();
  const values = {
    slotId: "slot_1",
    bookingId: "",
    intent: "time_change",
    detail: "09:30",
    note: "",
    ...over,
  };
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
}

/*
  The refusal as `openapi-fetch` hands it back: `error` beside no `data`, which
  the action throws into its own catch. Resolved rather than rejected on
  purpose: a mock that rejects is reported by vitest as a failure of the test
  even when the action catches it.
*/
function refuse(code: string, status: number) {
  post.mockResolvedValue({
    data: undefined,
    error: new OperatorApiError({ code, message: code, status }),
  });
}

beforeEach(() => post.mockReset());

describe("telling a departure: yuvoy-operator#89, #90", () => {
  it("carries who was told, how, and who could not be reached", async () => {
    post.mockResolvedValue({
      data: {
        recipients: 2,
        byChannel: { email: 2 },
        notReached: 1,
        notReachedNote: "1 person could not be sent this \u2014 no address.",
      },
      error: undefined,
    });

    const state = await sendRelay({}, relayForm());

    expect(state).toMatchObject({
      intent: "time_change",
      recipients: 2,
      byChannel: { email: 2 },
      notReached: 1,
    });
    // The API's sentence, through dedash: no long dash reaches the screen.
    expect(state.notReachedNote).not.toMatch(/[\u2013\u2014\u2015]/);
    expect(state.notReachedNote).toMatch(/no address/i);
  });

  it("reads an older API, with none of the new fields, as it always did", async () => {
    post.mockResolvedValue({ data: { recipients: 3 }, error: undefined });

    const state = await sendRelay({}, relayForm());

    expect(state).toEqual({ intent: "time_change", recipients: 3 });
  });

  it("leaves out a notReached of zero, which the API should not send", async () => {
    post.mockResolvedValue({
      data: { recipients: 3, notReached: 0, notReachedNote: "stale" },
      error: undefined,
    });

    const state = await sendRelay({}, relayForm());

    expect(state.notReached).toBeUndefined();
    expect(state.notReachedNote).toBeUndefined();
  });

  it("says there is nobody to tell, not to try again", async () => {
    refuse("nobody_to_tell", 409);

    const departure = await sendRelay({}, relayForm());
    expect(departure.message).toMatch(
      /Nobody on this departure has a live booking/,
    );
    expect(departure.message).not.toMatch(/Try again/);

    const booking = await sendRelay({}, relayForm({ bookingId: "bkg_1" }));
    expect(booking.message).toMatch(/This booking is no longer live/);
  });

  it("says the hourly limit is the problem, not the signal", async () => {
    refuse("too_many_updates", 429);

    const state = await sendRelay({}, relayForm());

    expect(state.message).toMatch(/most updates you can send in an hour/);
    expect(state.recipients).toBeUndefined();
  });
});

function callOffForm(): FormData {
  const f = new FormData();
  f.set("slotId", "slot_1");
  f.set("reasonCode", "weather");
  f.set("note", "");
  f.set("confirmSlotId", "slot_1");
  return f;
}

describe("calling a departure off: yuvoy-operator#95", () => {
  it("reports the cash it did not refund", async () => {
    post.mockResolvedValue({
      data: {
        bookingsCancelled: 2,
        guestsAffected: 3,
        refundedPaise: 900_000,
        holdsReleased: 0,
        cashToGiveBack: {
          totalPaise: 450_000,
          parties: [
            {
              bookingId: "bkg_cash",
              reference: "YV-CASH0001",
              name: "Nadia",
              guests: 1,
              amountPaise: 450_000,
            },
          ],
          note: "Hand it back.",
        },
      },
      error: undefined,
    });

    const state = await callOffDeparture({}, callOffForm());

    expect(state.result?.refundedPaise).toBe(900_000);
    expect(state.result?.giveBack).toEqual({
      totalPaise: 450_000,
      parties: [
        {
          bookingId: "bkg_cash",
          reference: "YV-CASH0001",
          name: "Nadia",
          guests: 1,
          amountPaise: 450_000,
        },
      ],
    });
  });

  it("has nothing to give back on an ordinary call-off", async () => {
    post.mockResolvedValue({
      data: {
        bookingsCancelled: 1,
        guestsAffected: 2,
        refundedPaise: 900_000,
        holdsReleased: 1,
      },
      error: undefined,
    });

    const state = await callOffDeparture({}, callOffForm());

    expect(state.result?.giveBack).toBeNull();
  });

  it("does not claim everybody was told when it was already called off", async () => {
    refuse("already_called_off", 409);

    const state = await callOffDeparture({}, callOffForm());

    expect(state.message).toBe("This departure is already called off.");
  });
});
