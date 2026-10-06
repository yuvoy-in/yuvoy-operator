import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  Joining from a link, when the answer is not the one hoped for (the
  stability audit, P1-1 and P2-3).

  The box that agrees to leave another business is drawn from state. A reset
  in place unticked it after a wrong code while the agreement it stood for,
  and the field carrying it, stayed: the box said no and the next tap said
  yes. And a request that never came back took the page to the error screen.
*/

const requestJoinCode = vi.fn();
const acceptJoin = vi.fn();
vi.mock("./actions", () => ({
  requestJoinCode: (token: string, prev: unknown, form: FormData) =>
    requestJoinCode(token, prev, form),
  acceptJoin: (token: string, prev: unknown, form: FormData) =>
    acceptJoin(token, prev, form),
}));

const { JoinTokenForm } = await import("./join-token-form");

afterEach(() => {
  requestJoinCode.mockReset();
  acceptJoin.mockReset();
});

const CODE_STEP = {
  step: "code" as const,
  phone: "+919000000101",
  invited: { businessName: "Nemo Reef", role: "STAFF" },
  leavingBusiness: "Coral Divers",
};

async function reachTheCode() {
  requestJoinCode.mockResolvedValue(CODE_STEP);
  render(<JoinTokenForm token="tok_1" businessName="Nemo Reef" />);
  fireEvent.change(screen.getByLabelText("Your phone number"), {
    target: { value: "9000000101" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  });
  await screen.findByLabelText("Your code");
}

async function joinWith(code: string) {
  fireEvent.change(screen.getByLabelText("Your code"), {
    target: { value: code },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Join and leave Coral Divers" }),
    );
  });
}

describe("a refused join", () => {
  it("still shows the box ticked when the agreement still goes", async () => {
    await reachTheCode();
    fireEvent.click(screen.getByLabelText("Yes, take me off Coral Divers."));
    acceptJoin.mockResolvedValueOnce({
      ...CODE_STEP,
      message: "That did not work. Try the code again.",
    });
    await joinWith("111111");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Try the code again.",
    );

    // What is drawn is what is sent.
    const box = screen.getByLabelText("Yes, take me off Coral Divers.");
    expect(box).toBeChecked();
    acceptJoin.mockResolvedValueOnce({ ...CODE_STEP, message: "Again." });
    await joinWith("222222");
    const sent: FormData = acceptJoin.mock.calls[1][2];
    expect(sent.get("confirmLeaving")).toBe("yes");
  });

  it("says no signal on the code step when the request never came back", async () => {
    await reachTheCode();
    fireEvent.click(screen.getByLabelText("Yes, take me off Coral Divers."));
    acceptJoin.mockRejectedValue(new TypeError("Failed to fetch"));
    await joinWith("482913");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. Nothing changed.",
    );
    // Still on the code step, with the code typed again.
    expect(screen.getByLabelText("Your code")).toHaveValue("");
  });

  it("says no signal on the number when the request never came back", async () => {
    requestJoinCode.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<JoinTokenForm token="tok_1" businessName="Nemo Reef" />);
    fireEvent.change(screen.getByLabelText("Your phone number"), {
      target: { value: "9000000101" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. Try again.",
    );
    expect(screen.getByLabelText("Your phone number")).toHaveValue(
      "9000000101",
    );
  });
});
