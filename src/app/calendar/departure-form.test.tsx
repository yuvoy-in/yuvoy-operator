import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  A refused batch keeps what was typed (the stability audit, P1-1).

  React resets a form when its action resolves, refusals included. The
  listing went back to "Choose a listing" and every number to its default,
  and a day chip the screen still drew as ticked was unticked underneath, so
  the count above the button said one batch and the next tap sent another.
*/

const addDepartures = vi.fn();
vi.mock("./actions", () => ({
  addDepartures: (prev: unknown, form: FormData) => addDepartures(prev, form),
}));

const { DepartureForm } = await import("./departure-form");

afterEach(() => addDepartures.mockReset());

const LISTINGS = [
  { id: "exp_reef", title: "Reef dive" },
  { id: "exp_dawn", title: "Dawn snorkel" },
];

// A Monday, so a fortnight from it holds two of every weekday.
const TODAY = "2026-10-05";

async function fillAndAdd() {
  render(<DepartureForm listings={LISTINGS} today={TODAY} />);
  fireEvent.click(screen.getByRole("button", { name: "Add departures" }));
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  type("Which listing", "exp_dawn");
  type("Last day", "2026-10-18");
  fireEvent.click(screen.getByLabelText("Saturday"));
  type("Seats on each departure", "8");
  fireEvent.click(screen.getByRole("button", { name: "More options" }));
  type("How long it runs, in minutes", "90");
  // Two Saturdays at 07:00, said before the tap.
  expect(screen.getByRole("status")).toHaveTextContent("2 departures");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add 2 departures" }));
  });
}

describe("a refused batch of departures", () => {
  it("keeps the listing, the numbers, and the days it said it would add", async () => {
    addDepartures.mockResolvedValue({
      message:
        "Only owners, admins and managers can change seats or close dates.",
    });
    await fillAndAdd();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only owners, admins and managers",
    );
    expect(screen.getByLabelText("Which listing")).toHaveValue("exp_dawn");
    expect(screen.getByLabelText("Seats on each departure")).toHaveValue(8);
    expect(screen.getByLabelText("How long it runs, in minutes")).toHaveValue(
      90,
    );
    // The chip and the box under it say the same thing as the count.
    expect(screen.getByLabelText("Saturday")).toBeChecked();
    expect(screen.getByLabelText("Sunday")).not.toBeChecked();
    expect(screen.getByRole("status")).toHaveTextContent("2 departures");
  });

  it("sends again exactly what the count says", async () => {
    addDepartures.mockResolvedValue({
      message: "No signal. Nothing was added.",
    });
    await fillAndAdd();
    await screen.findByRole("alert");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add 2 departures" }));
    });
    const again: FormData = addDepartures.mock.calls[1][1];
    expect(again.get("experienceId")).toBe("exp_dawn");
    expect(again.getAll("weekdays")).toEqual(["6"]);
    expect(again.get("seats")).toBe("8");
    expect(again.get("durationMinutes")).toBe("90");
  });

  it("never resends a fortnight of every day for the Saturdays it showed", async () => {
    // One listing, so nothing but the day chips decides what goes again.
    addDepartures.mockResolvedValue({
      message: "No signal. Nothing was added.",
    });
    render(<DepartureForm listings={[LISTINGS[0]]} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Add departures" }));
    fireEvent.change(screen.getByLabelText("Last day"), {
      target: { value: "2026-10-18" },
    });
    fireEvent.click(screen.getByLabelText("Saturday"));
    const add = () =>
      act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Add 2 departures" }),
        );
      });
    await add();
    await screen.findByRole("alert");
    await add();

    const again: FormData = addDepartures.mock.calls[1][1];
    expect(again.getAll("weekdays")).toEqual(["6"]);
    expect(screen.getByLabelText("Saturday")).toBeChecked();
  });

  it("says no signal in place when the request never came back", async () => {
    addDepartures.mockRejectedValue(new TypeError("Failed to fetch"));
    await fillAndAdd();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. Nothing was added.",
    );
    expect(screen.getByLabelText("Which listing")).toHaveValue("exp_dawn");
  });
});
