import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
