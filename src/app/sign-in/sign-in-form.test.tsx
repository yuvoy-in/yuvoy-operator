import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  Signing in when the request never comes back (the stability audit, P2-3).

  A rejected action used to take the door to the error screen, with the
  number typed. It says the actions' own sentence now, on the step it was on.
*/

const requestCode = vi.fn();
const submitCode = vi.fn();
const enterExistingCode = vi.fn();
vi.mock("./actions", () => ({
  requestCode: (prev: unknown, form: FormData) => requestCode(prev, form),
  submitCode: (prev: unknown, form: FormData) => submitCode(prev, form),
  enterExistingCode: (prev: unknown, form: FormData) =>
    enterExistingCode(prev, form),
}));

const { SignInForm } = await import("./sign-in-form");

afterEach(() => {
  requestCode.mockReset();
  submitCode.mockReset();
  enterExistingCode.mockReset();
});

const UNREACHABLE =
  "We could not reach Yuvoy. Check your signal and try again.";

async function askForACode() {
  render(<SignInForm />);
  fireEvent.change(screen.getByLabelText("Your phone number"), {
    target: { value: "9000000101" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
  });
}

describe("a sign-in that never came back", () => {
  it("keeps the number on the first step", async () => {
    requestCode.mockRejectedValue(new TypeError("Failed to fetch"));
    await askForACode();

    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE);
    expect(screen.getByLabelText("Your phone number")).toHaveValue(
      "9000000101",
    );
  });

  it("stays on the code step, for the number it was asked for", async () => {
    requestCode.mockResolvedValue({ step: "code", phone: "+919000000101" });
    submitCode.mockRejectedValue(new TypeError("Failed to fetch"));
    await askForACode();
    fireEvent.change(await screen.findByLabelText("Your code"), {
      target: { value: "482913" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(UNREACHABLE);
    expect(screen.getByLabelText("Your code")).toBeInTheDocument();
    expect(screen.getByText(/For/)).toHaveTextContent("90000 00101");
  });
});
