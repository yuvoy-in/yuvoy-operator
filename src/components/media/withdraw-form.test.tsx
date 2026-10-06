import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { watchMotion } from "@/lib/motion/testing";

const withdrawMedia = vi.fn<(prev: unknown, form: FormData) => Promise<object>>(
  async () => ({}),
);
vi.mock("./actions", () => ({
  withdrawMedia: (prev: unknown, form: FormData) => withdrawMedia(prev, form),
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

/*
  O06 B (approved 4 Oct 2026): the question fades in where the words were,
  and Not now fades a held copy of it out as they come back
  (`useStillConfirm`).
*/
describe("arriving and leaving still", () => {
  let motion: ReturnType<typeof watchMotion>;
  beforeEach(() => {
    motion = watchMotion();
  });
  afterEach(() => motion.restore());

  it("fades the question in, and Not now fades a held copy out as the words come back", async () => {
    const user = userEvent.setup();
    render(<WithdrawForm mediaAssetId="med_1" attachedTo="Wall dive" />);
    await user.click(screen.getByRole("button", { name: "Take it down" }));
    const question = screen.getByText("Why is it coming down?");
    expect(motion.fadeOf(question.closest("form"))).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Not now" }));
    const trigger = screen.getByRole("button", { name: "Take it down" });
    expect(motion.fadeOf(trigger.parentElement)).toBeDefined();
    const [copy] = motion.copies();
    expect(copy).toHaveTextContent("Why is it coming down?");
    expect(motion.exitOf(copy)).toBeDefined();
  });
});

/*
  The stability audit, P1-1 and P2-3. React resets a form when its action
  resolves, refusals included, so a refused take-down came back with no
  reason chosen; and one that never came back took the reels to the error
  screen.
*/
describe("a take-down that did not go", () => {
  async function takeDown() {
    const user = userEvent.setup();
    render(<WithdrawForm mediaAssetId="med_1" />);
    await user.click(screen.getByRole("button", { name: "Take it down" }));
    await user.click(
      screen.getByRole("radio", { name: /Somebody in it objected/ }),
    );
    await user.click(screen.getByRole("button", { name: "Take it down" }));
  }

  it("keeps the reason chosen under the refusal", async () => {
    withdrawMedia.mockResolvedValueOnce({
      message: "That clip is not here any more. It may already be down.",
    });
    await takeDown();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That clip is not here any more.",
    );
    expect(
      screen.getByRole("radio", { name: /Somebody in it objected/ }),
    ).toBeChecked();
  });

  it("says no signal in place when the request never came back", async () => {
    withdrawMedia.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await takeDown();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. It is still up. Try again.",
    );
    expect(
      screen.getByRole("radio", { name: /Somebody in it objected/ }),
    ).toBeChecked();
  });
});
