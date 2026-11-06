import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  Signing up when the request never comes back (the stability audit, P2-3).

  A rejected action used to take the door to the error screen, and with it
  the business name, the person's name, the number and the email somebody
  had typed on a phone. It is refused the way the action refuses now: the
  details handed back, on the form they were typed into.
*/

const createAccount = vi.fn();
vi.mock("./actions", () => ({
  createAccount: (prev: unknown, form: FormData) => createAccount(prev, form),
  finishSignUp: vi.fn(),
  resendCode: vi.fn(),
}));

const { SignUpForm } = await import("./signup-form");

afterEach(() => createAccount.mockReset());

describe("a sign-up that never came back", () => {
  it("says no signal and keeps every detail typed", async () => {
    createAccount.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<SignUpForm />);
    const type = (label: string | RegExp, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    type("Your business name", "Reef Divers Havelock");
    fireEvent.click(screen.getByRole("radio", { name: /I own it/ }));
    type("Your name", "Priya Raut");
    type("Your phone number", "9000000101");
    type(/Email address/, "priya@reefdivers.in");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. Nothing was sent. Try again.",
    );
    expect(screen.getByLabelText("Your business name")).toHaveValue(
      "Reef Divers Havelock",
    );
    expect(screen.getByRole("radio", { name: /I own it/ })).toBeChecked();
    expect(screen.getByLabelText("Your name")).toHaveValue("Priya Raut");
    expect(screen.getByLabelText("Your phone number")).toHaveValue(
      "9000000101",
    );
    expect(screen.getByLabelText(/Email address/)).toHaveValue(
      "priya@reefdivers.in",
    );
  });
});

describe("signing up from a claim link (yuvoy-operator#388)", () => {
  it("hands the listing on to the action and to the sign-in link", async () => {
    createAccount.mockResolvedValue({ step: "details", message: "Try again." });
    render(<SignUpForm next="/claim/example-reef-divers" />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?next=%2Fclaim%2Fexample-reef-divers",
    );
    fireEvent.change(screen.getByLabelText("Your business name"), {
      target: { value: "Reef Divers Havelock" },
    });
    fireEvent.click(screen.getByRole("radio", { name: /I own it/ }));
    fireEvent.change(screen.getByLabelText("Your name"), {
      target: { value: "Priya Raut" },
    });
    fireEvent.change(screen.getByLabelText("Your phone number"), {
      target: { value: "9000000101" },
    });
    fireEvent.change(screen.getByLabelText(/Email address/), {
      target: { value: "priya@reefdivers.in" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    });
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({ next: "/claim/example-reef-divers" }),
      expect.any(FormData),
    );
  });

  it("with no listing, signs in plainly", () => {
    render(<SignUpForm />);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });
});
