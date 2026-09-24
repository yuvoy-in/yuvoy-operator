import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("./actions", () => ({
  withdrawMedia: vi.fn(async () => ({})),
}));

const { WithdrawForm } = await import("./withdraw-form");

/*
  Taking a clip down empties the card a traveller is looking at. The way in was
  a secondary pill, the same shape as the actions beside it (the audit before
  release, O14, and yuvoy-operator#81 t5).
*/
describe("taking a clip down", () => {
  it("is quiet text until asked, and the loud button is inside the confirm", async () => {
    const user = userEvent.setup();
    render(<WithdrawForm mediaAssetId="med_1" attachedTo="Night fishing" />);

    const trigger = screen.getByRole("button", { name: "Take it down" });
    expect(trigger).toHaveClass("text-terra-deep");
    expect(trigger).not.toHaveClass("border-2");

    await user.click(trigger);
    expect(
      screen.getByText(
        "It is on Night fishing. That listing loses this video.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Take it down" })).toHaveClass(
      "border-2",
      "border-terra-deep",
    );
  });

  it("puts focus on the question, and Not now gives it back", async () => {
    const user = userEvent.setup();
    render(<WithdrawForm mediaAssetId="med_1" />);
    await user.click(screen.getByRole("button", { name: "Take it down" }));
    expect(screen.getByText("Why is it coming down?")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByRole("button", { name: "Take it down" })).toHaveFocus();
  });
});
