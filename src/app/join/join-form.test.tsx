import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  Accepting an invitation, when the answer is not the one hoped for (the
  stability audit, P1-1 and P2-3).

  The number survives a refusal on its own: `PhoneField` holds it, and a
  reset leaves a controlled field alone. The code does not, on purpose, as at
  sign-in. What was broken is the accept that never came back, which took
  the whole page to the error screen.
*/

const acceptInvite = vi.fn();
vi.mock("./actions", () => ({
  acceptInvite: (prev: unknown, form: FormData) => acceptInvite(prev, form),
}));

const { JoinForm } = await import("./join-form");

afterEach(() => acceptInvite.mockReset());

async function accept() {
  render(<JoinForm />);
  fireEvent.change(screen.getByLabelText("Your phone number"), {
    target: { value: "9000000101" },
  });
  fireEvent.change(screen.getByLabelText("Your code"), {
    target: { value: "482913" },
  });
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Accept the invitation" }),
    );
  });
}

describe("a refused invitation", () => {
  it("keeps the number, and asks for the code again", async () => {
    acceptInvite.mockResolvedValue({
      message: "That code did not work. Check it and try again.",
    });
    await accept();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That code did not work.",
    );
    expect(screen.getByLabelText("Your phone number")).toHaveValue(
      "9000000101",
    );
    expect(screen.getByLabelText("Your code")).toHaveValue("");
  });

  it("says no signal in place when the request never came back", async () => {
    acceptInvite.mockRejectedValue(new TypeError("Failed to fetch"));
    await accept();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not reach Yuvoy. Check your signal and try again.",
    );
    expect(screen.getByLabelText("Your phone number")).toHaveValue(
      "9000000101",
    );
  });
});
