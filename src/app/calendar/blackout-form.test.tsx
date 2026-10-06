import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { watchMotion } from "@/lib/motion/testing";

const addBlackout = vi.fn();

vi.mock("./actions", () => ({
  addBlackout: (prev: unknown, form: FormData) => addBlackout(prev, form),
}));

const { BlackoutForm } = await import("./blackout-form");

/*
  Closing a range of dates, at the top of the calendar, in the shape every
  act that ends something takes here (yuvoy-operator#81). O06 B (approved
  4 Oct 2026): the question fades in where the words were, Keep them open
  fades a held copy of it out as they come back, the receipt fades in with
  no copy, and so does the fresh form "Close more dates" asks for
  (`useStillConfirm`).
*/
describe("closing a range of dates, arriving and leaving still", () => {
  let motion: ReturnType<typeof watchMotion>;
  beforeEach(() => {
    motion = watchMotion();
    addBlackout.mockReset().mockResolvedValue({});
  });
  afterEach(() => motion.restore());

  const open = () =>
    fireEvent.click(
      screen.getByRole("button", { name: "Close dates to new bookings" }),
    );
  const question = () =>
    screen.getByText("Close dates to new bookings", { selector: "p" });

  it("fades the question in, and Keep them open fades a held copy out as the words come back", () => {
    render(<BlackoutForm today="2026-10-05" />);
    expect(motion.played).toHaveLength(0);
    open();
    expect(motion.fadeOf(question().closest("form"))).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Keep them open" }));
    const trigger = screen.getByRole("button", {
      name: "Close dates to new bookings",
    });
    expect(motion.fadeOf(trigger.parentElement)).toBeDefined();
    const [copy] = motion.copies();
    expect(copy).toHaveTextContent("This stops new sales.");
    expect(motion.exitOf(copy)).toBeDefined();
  });

  it("fades the receipt in with no copy, and then the fresh form Close more dates asks for", async () => {
    addBlackout.mockResolvedValue({ result: { existingBookings: 0 } });
    render(<BlackoutForm today="2026-10-05" />);
    open();
    fireEvent.click(screen.getByRole("radio", { name: "Weather" }));
    fireEvent.click(screen.getByRole("button", { name: "Close them" }));
    const receipt = await screen.findByText(
      "Those dates are closed to new bookings",
    );
    expect(motion.fadeOf(receipt.parentElement)).toBeDefined();
    expect(motion.copies()).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Close more dates" }));
    const trigger = screen.getByRole("button", {
      name: "Close dates to new bookings",
    });
    expect(motion.fadeOf(trigger.parentElement)).toBeDefined();
  });
});

/*
  The stability audit, P1-1. React resets a form when its action resolves,
  refusals included: a range refused for its last day came back as today to
  today, with no reason and no note.
*/
describe("a refused closure", () => {
  async function closeThem() {
    render(<BlackoutForm today="2026-10-05" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Close dates to new bookings" }),
    );
    fireEvent.change(screen.getByLabelText("First day"), {
      target: { value: "2026-10-12" },
    });
    fireEvent.change(screen.getByLabelText("Last day"), {
      target: { value: "2026-10-10" },
    });
    fireEvent.click(screen.getByRole("radio", { name: "Out of season" }));
    fireEvent.change(screen.getByLabelText("Anything to add (optional)"), {
      target: { value: "Monsoon" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Close them" }));
    });
  }

  it("keeps the dates, the reason and the note", async () => {
    addBlackout.mockReset().mockResolvedValue({
      message: "The last day cannot be before the first.",
    });
    await closeThem();

    expect(
      await screen.findByText("The last day cannot be before the first."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("First day")).toHaveValue("2026-10-12");
    expect(screen.getByLabelText("Last day")).toHaveValue("2026-10-10");
    expect(screen.getByRole("radio", { name: "Out of season" })).toBeChecked();
    expect(screen.getByLabelText("Anything to add (optional)")).toHaveValue(
      "Monsoon",
    );
  });

  it("says no signal in place when the request never came back", async () => {
    addBlackout.mockReset().mockRejectedValue(new TypeError("Failed to fetch"));
    await closeThem();

    expect(
      await screen.findByText("No signal. Nothing was closed."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("First day")).toHaveValue("2026-10-12");
  });
});
