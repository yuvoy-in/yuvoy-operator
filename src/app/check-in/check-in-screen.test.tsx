import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { holdCheckInLink } from "@/lib/day/check-in-link";
import { NOT_A_CODE, UNSENT, type CheckInResult } from "./check-in-result";

/*
  The /check-in screen (yuvoy-operator#175): a good link is sent once, on its
  own, and leaves the address bar; a code that missed is never sent again
  from here; a dead session keeps the link for after sign-in.
*/

const checkInWithCode = vi.fn<(input: unknown) => Promise<CheckInResult>>();

vi.mock("./actions", () => ({
  checkInWithCode: (input: unknown) => checkInWithCode(input),
}));

const { CheckInScreen } = await import("./check-in-screen");

const ARRIVED: CheckInResult = {
  ok: true,
  bookingId: "bkg_1",
  reference: "YV-4K2M9P7Q",
  name: "Asha Menon",
  guests: 2,
  slotId: "slot_1",
  arrivedAt: "2026-11-03T01:30:00Z",
  alreadyCheckedIn: false,
};

function openAt(hash: string) {
  window.history.replaceState(null, "", `/check-in${hash}`);
}

function sentKeys(): unknown[] {
  return checkInWithCode.mock.calls.map(
    ([input]) => (input as { key?: string }).key,
  );
}

beforeEach(() => openAt(""));
afterEach(() => {
  checkInWithCode.mockReset();
  sessionStorage.clear();
});

describe("opened from a traveller's link", () => {
  it("checks them in once, on its own, and clears the code from the address", async () => {
    checkInWithCode.mockResolvedValue(ARRIVED);
    openAt("#YV-4K2M9P7Q.K7QM2XPA");
    render(
      <StrictMode>
        <CheckInScreen />
      </StrictMode>,
    );

    expect(await screen.findByText("Asha Menon")).toBeInTheDocument();
    expect(screen.getByText("2 guests, YV-4K2M9P7Q")).toBeInTheDocument();
    expect(screen.getByText("Checked in at 07:00")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Open the boarding list" }),
    ).toHaveAttribute("href", "/today/slot_1/boarding");

    expect(checkInWithCode).toHaveBeenCalledTimes(1);
    expect(checkInWithCode).toHaveBeenCalledWith({
      code: "K7QM2XPA",
      reference: "YV-4K2M9P7Q",
      via: "portal_link",
      key: expect.stringMatching(/^msg_/),
    });
    expect(window.location.hash).toBe("");
    expect(window.location.pathname).toBe("/check-in");
  });

  it("says a party that was already in, with the first time", async () => {
    checkInWithCode.mockResolvedValue({
      ...ARRIVED,
      guests: 1,
      alreadyCheckedIn: true,
    } as CheckInResult);
    openAt("#YV-4K2M9P7Q.K7QM2XPA");
    render(<CheckInScreen />);

    expect(
      await screen.findByText("Already checked in at 07:00"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 guest, YV-4K2M9P7Q")).toBeInTheDocument();
  });

  it("takes a link held through sign-in when there is no fragment", async () => {
    checkInWithCode.mockResolvedValue(ARRIVED);
    holdCheckInLink("#YV-4K2M9P7Q.K7QM2XPA");
    render(<CheckInScreen />);

    expect(await screen.findByText("Asha Menon")).toBeInTheDocument();
    expect(checkInWithCode).toHaveBeenCalledWith(
      expect.objectContaining({ reference: "YV-4K2M9P7Q", via: "portal_link" }),
    );
  });

  it("asks for the code when the fragment is not a check-in link", async () => {
    openAt("#cash-owed");
    render(<CheckInScreen />);

    expect(
      await screen.findByText(
        "That link is not a check-in link. Type the code the traveller shows instead.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Check-in code")).toBeInTheDocument();
    expect(checkInWithCode).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });
});

describe("when it does not go", () => {
  it("never offers a code that missed again, and points to Today", async () => {
    checkInWithCode.mockResolvedValue({
      ok: false,
      message: "This code is not for one of your bookings.",
      byName: true,
    });
    openAt("#YV-4K2M9P7Q.K7QM2XPA");
    render(<CheckInScreen />);

    expect(
      await screen.findByText("This code is not for one of your bookings."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Asha Menon")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Try again" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Check them in by name on Today" }),
    ).toHaveAttribute("href", "/today");
  });

  it("tries again under the same key after no signal", async () => {
    const user = userEvent.setup();
    checkInWithCode
      .mockResolvedValueOnce({ ok: false, message: UNSENT, retry: true })
      .mockResolvedValueOnce(ARRIVED);
    openAt("#YV-4K2M9P7Q.K7QM2XPA");
    render(<CheckInScreen />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Asha Menon")).toBeInTheDocument();
    const [first, second] = sentKeys();
    expect(second).toBe(first);
  });

  it("takes a new key when the API will not take that one again", async () => {
    const user = userEvent.setup();
    checkInWithCode
      .mockResolvedValueOnce({
        ok: false,
        message: "That did not go. Nobody was checked in. Try again.",
        retry: true,
        newKey: true,
      })
      .mockResolvedValueOnce(ARRIVED);
    openAt("#YV-4K2M9P7Q.K7QM2XPA");
    render(<CheckInScreen />);

    await user.click(await screen.findByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Asha Menon")).toBeInTheDocument();
    const [first, second] = sentKeys();
    expect(second).toMatch(/^msg_/);
    expect(second).not.toBe(first);
  });

  it("keeps the link through sign-in when the session has ended", async () => {
    checkInWithCode.mockResolvedValue({
      ok: false,
      message: "Your session has ended. Sign in again, then check them in.",
      signIn: true,
    });
    openAt("#YV-4K2M9P7Q.K7QM2XPA");
    render(<CheckInScreen />);

    expect(
      await screen.findByRole("link", { name: "Sign in again" }),
    ).toHaveAttribute("href", "/sign-in?next=%2Fcheck-in");
    expect(JSON.parse(sessionStorage.getItem("yvo.check-in") ?? "{}")).toEqual(
      expect.objectContaining({ reference: "YV-4K2M9P7Q", code: "K7QM2XPA" }),
    );
  });
});

describe("typing a code", () => {
  it("refuses one that cannot be a code without sending it", async () => {
    const user = userEvent.setup();
    render(<CheckInScreen />);

    await user.type(await screen.findByLabelText("Check-in code"), "K7QM");
    await user.click(screen.getByRole("button", { name: "Check in" }));

    expect(screen.getByText(NOT_A_CODE)).toBeInTheDocument();
    expect(checkInWithCode).not.toHaveBeenCalled();
  });

  it("sends a typed code with no reference", async () => {
    const user = userEvent.setup();
    checkInWithCode.mockResolvedValue(ARRIVED);
    render(<CheckInScreen />);

    await user.type(await screen.findByLabelText("Check-in code"), "k7qm 2xpa");
    await user.click(screen.getByRole("button", { name: "Check in" }));

    expect(await screen.findByText("Asha Menon")).toBeInTheDocument();
    expect(checkInWithCode).toHaveBeenCalledWith({
      code: "K7QM2XPA",
      via: "typed",
      key: expect.stringMatching(/^msg_/),
    });
  });
});
