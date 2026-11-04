import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PartyRow } from "./party-row";
import { party, TZ } from "./party-row-kit";

/**
 * The second tap. A no-show is permanent — the API refuses to overwrite a
 * settled booking — so it is armed by one tap and sent by another, and the
 * screen says so in between.
 */
const markAttendance = vi.fn<
  (prev: unknown, form: FormData) => Promise<object>
>(async () => ({}));
vi.mock("./actions", () => ({
  markAttendance: (prev: unknown, form: FormData) => markAttendance(prev, form),
  sendRelay: vi.fn(async () => ({})),
}));
vi.mock("@/app/bookings/cash-actions", () => ({
  recordCashCollected: vi.fn(async () => ({})),
}));
vi.mock("@/app/bookings/cancel-actions", () => ({
  cancelBooking: vi.fn(async () => ({})),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/today/slot_dawn",
}));

describe("PartyRow — terminal outcomes", () => {
  it("asks before recording a no-show, and records it on the second tap", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );

    await user.click(screen.getByRole("button", { name: "No-show" }));
    expect(markAttendance).not.toHaveBeenCalled();
    expect(
      screen.getByText(/Mark Asha Menon as a no-show\? This cannot be changed/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Confirm no-show" }));
    expect(markAttendance).toHaveBeenCalledTimes(1);
    const form = markAttendance.mock.calls[0][1];
    expect(form.get("outcome")).toBe("no_show");
    expect(form.get("bookingId")).toBe("bk_1");
  });

  it("can be disarmed", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await user.click(screen.getByRole("button", { name: "Not that" }));
    expect(screen.getByRole("button", { name: "No-show" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
  });

  it("keeps arriving to one tap", async () => {
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    const before = Date.now();
    await user.click(screen.getByRole("button", { name: "Check in" }));
    expect(markAttendance).toHaveBeenCalled();
    // When they were seen, stamped at the tap (yuvoy-api#263).
    const form = markAttendance.mock.calls.at(-1)?.[1] as FormData;
    const seen = Date.parse(String(form.get("seenAt")));
    expect(seen).toBeGreaterThanOrEqual(before);
    expect(seen).toBeLessThanOrEqual(Date.now());
  });

  it("says nothing of when they were seen on a terminal outcome", async () => {
    markAttendance.mockClear();
    const user = userEvent.setup();
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    await user.click(screen.getByRole("button", { name: "Completed" }));
    await user.click(screen.getByRole("button", { name: "Confirm completed" }));
    const form = markAttendance.mock.calls.at(-1)?.[1] as FormData;
    expect(form.get("outcome")).toBe("completed");
    expect(form.get("seenAt")).toBeNull();
  });

  it("says Checked in once they are, with a drawn tick rather than a character", () => {
    /*
      yuvoy-operator#88 s3: "Here" is our word, and on a jetty it reads as a
      question. The button and the total above the list say the same thing.
    */
    render(
      <ul>
        <PartyRow
          party={{ ...party, arrived: true }}
          slotId="slot_dawn"
          departed
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    const done = screen.getByRole("button", { name: "Checked in" });
    expect(done.querySelector("svg")).not.toBeNull();
    expect(done.textContent).not.toMatch(/[✓✔]/);
    expect(screen.queryByRole("button", { name: /^Here/ })).toBeNull();
  });

  it("offers a message to the one party, by name", () => {
    render(
      <ul>
        <PartyRow
          party={party}
          slotId="slot_dawn"
          departed={false}
          screening={null}
          cash={null}
          timezone={TZ}
          canManage={false}
        />
      </ul>,
    );
    expect(
      screen.getByRole("button", { name: "Message Asha Menon" }),
    ).toBeInTheDocument();
  });
});

/*
  With no signal (operator experiment D; owner go-ahead and storage ruling,
  4 Oct 2026). Checking in is kept on the phone and sent when the signal is
  back; closing out, messages and cancelling wait for the signal.
*/
describe("PartyRow with no signal", () => {
  async function offlineRow(departed = false) {
    const { ChromeProvider } =
      await import("@/components/chrome/chrome-context");
    const { offlineWrites } = await import("@/lib/site/offline-writes");
    offlineWrites.forget();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(
      <ChromeProvider
        identity={{ businessName: null, canManage: true, userId: "usr_owner" }}
      >
        <ul>
          <PartyRow
            party={party}
            slotId="slot_dawn"
            departed={departed}
            screening={null}
            cash={null}
            timezone={TZ}
            canManage
          />
        </ul>
      </ChromeProvider>,
    );
    return offlineWrites;
  }

  it("keeps a check-in on the phone, and says so in place of the button", async () => {
    markAttendance.mockClear();
    const offlineWrites = await offlineRow();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Check in" }));

    expect(markAttendance).not.toHaveBeenCalled();
    expect(offlineWrites.list()).toMatchObject([
      {
        kind: "arrived",
        userId: "usr_owner",
        slotId: "slot_dawn",
        bookingId: "bk_1",
      },
    ]);
    // Kept with the tap's time, which is the `seenAt` it is sent with later.
    expect(Math.abs(offlineWrites.list()[0].at - Date.now())).toBeLessThan(
      5_000,
    );
    expect(
      screen.getByText(
        "Checked in on this phone. Sends when the signal is back.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Check in" })).toBeNull();
    vi.restoreAllMocks();
  });

  it("offers no message or cancel until the signal is back", async () => {
    await offlineRow();
    expect(
      screen.getByRole("button", { name: "Message Asha Menon" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Cancel this booking" }),
    ).toBeDisabled();
    // Checking in still works: it is kept on the phone.
    expect(screen.getByRole("button", { name: "Check in" })).toBeEnabled();
    vi.restoreAllMocks();
  });

  it("offers no closing out once the boat has left, until the signal is back", async () => {
    await offlineRow(true);
    expect(screen.getByRole("button", { name: "Completed" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No-show" })).toBeDisabled();
    vi.restoreAllMocks();
  });
});

/*
  A session that ended at the jetty. The action's `requireOperator()`
  redirects to sign in, and Next 16.3's router follows that redirect itself:
  the call only rejects with it afterwards, marked handled
  (router-reducer/reducers/server-action-reducer.js). So the row catching it
  strands nobody, and catching it is what keeps the check-in, which the
  replayer sends once the operator has signed in again. Handing it back to
  Next instead (`unstable_rethrow`, as the forms do) would lose the check-in.
*/
describe("PartyRow when the session ends mid check-in", () => {
  it("keeps the check-in for after sign in", async () => {
    const { redirect } =
      await vi.importActual<typeof import("next/navigation")>(
        "next/navigation",
      );
    let ended: unknown;
    try {
      redirect("/sign-in");
    } catch (error) {
      ended = Object.assign(error as object, { handled: true });
    }
    markAttendance.mockRejectedValueOnce(ended);

    const { ChromeProvider } =
      await import("@/components/chrome/chrome-context");
    const { offlineWrites } = await import("@/lib/site/offline-writes");
    offlineWrites.forget();
    render(
      <ChromeProvider
        identity={{ businessName: null, canManage: true, userId: "usr_owner" }}
      >
        <ul>
          <PartyRow
            party={party}
            slotId="slot_dawn"
            departed={false}
            screening={null}
            cash={null}
            timezone={TZ}
            canManage
          />
        </ul>
      </ChromeProvider>,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Check in" }));

    expect(markAttendance).toHaveBeenCalled();
    expect(offlineWrites.list()).toMatchObject([
      { kind: "arrived", userId: "usr_owner", bookingId: "bk_1" },
    ]);
    offlineWrites.forget();
  });
});
