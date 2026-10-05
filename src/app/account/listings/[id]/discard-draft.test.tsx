import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { watchMotion } from "@/lib/motion/testing";

const discardDraft = vi.fn();

vi.mock("./actions", () => ({
  discardDraft: (prev: unknown, form: FormData) => discardDraft(prev, form),
}));

const { DiscardDraft } = await import("./discard-draft");

afterEach(() => discardDraft.mockReset());

/*
  yuvoy-operator#112, in the shape every act that ends something takes here
  (yuvoy-operator#81): quiet text until asked, a confirm that names what goes,
  the loud button inside it, and focus that follows the question.
*/
describe("discarding a draft", () => {
  it("is quiet text until asked, and the loud button is inside the confirm", async () => {
    const user = userEvent.setup();
    render(<DiscardDraft experienceId="exp_draft" title="Wall dive" />);

    const trigger = screen.getByRole("button", { name: "Discard this draft" });
    expect(trigger).toHaveClass("text-terra-deep");
    expect(trigger).not.toHaveClass("border-2");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(screen.getByText("Discard “Wall dive”?")).toHaveFocus();
    expect(
      screen.getByText(
        "It is deleted, with any departures saved on it. This cannot be undone.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Discard the draft" }),
    ).toHaveClass("border-2", "border-terra-deep");
  });

  it("gives focus back on Keep it, and discards nothing", async () => {
    const user = userEvent.setup();
    render(<DiscardDraft experienceId="exp_draft" title="Wall dive" />);

    await user.click(
      screen.getByRole("button", { name: "Discard this draft" }),
    );
    await user.click(screen.getByRole("button", { name: "Keep it" }));

    expect(
      screen.getByRole("button", { name: "Discard this draft" }),
    ).toHaveFocus();
    expect(discardDraft).not.toHaveBeenCalled();
  });

  it("sends the listing it is on", async () => {
    discardDraft.mockResolvedValue({});
    const user = userEvent.setup();
    render(<DiscardDraft experienceId="exp_draft" title="Wall dive" />);

    await user.click(
      screen.getByRole("button", { name: "Discard this draft" }),
    );
    await user.click(screen.getByRole("button", { name: "Discard the draft" }));

    expect(discardDraft).toHaveBeenCalledTimes(1);
    expect(discardDraft.mock.calls[0][1].get("experienceId")).toBe("exp_draft");
  });

  it("says a refusal under the question, with the draft still there", async () => {
    discardDraft.mockResolvedValue({
      message:
        "Only a draft can be deleted. This listing has already been sent to us.",
    });
    const user = userEvent.setup();
    render(<DiscardDraft experienceId="exp_draft" title="Wall dive" />);

    await user.click(
      screen.getByRole("button", { name: "Discard this draft" }),
    );
    await user.click(screen.getByRole("button", { name: "Discard the draft" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This listing has already been sent to us.",
    );
    // Still the confirm: the operator can keep it or try again.
    expect(screen.getByRole("button", { name: "Keep it" })).toBeVisible();
  });

  it("asks about the draft when it has no name yet", async () => {
    const user = userEvent.setup();
    render(<DiscardDraft experienceId="exp_draft" title="  " />);

    await user.click(
      screen.getByRole("button", { name: "Discard this draft" }),
    );

    expect(screen.getByText("Discard this draft?")).toHaveFocus();
  });
});

/*
  O06 B (approved 4 Oct 2026): the question fades in where the words were,
  and Keep it fades a held copy of it out as they come back
  (`useStillConfirm`).
*/
describe("arriving and leaving still", () => {
  let motion: ReturnType<typeof watchMotion>;
  beforeEach(() => {
    motion = watchMotion();
  });
  afterEach(() => motion.restore());

  it("fades the question in, and Keep it fades a held copy out as the words come back", async () => {
    const user = userEvent.setup();
    render(<DiscardDraft experienceId="exp_draft" title="Wall dive" />);
    await user.click(
      screen.getByRole("button", { name: "Discard this draft" }),
    );
    const question = screen.getByText("Discard “Wall dive”?");
    expect(motion.fadeOf(question.closest("form"))).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Keep it" }));
    const trigger = screen.getByRole("button", { name: "Discard this draft" });
    expect(motion.fadeOf(trigger.parentElement)).toBeDefined();
    const [copy] = motion.copies();
    expect(copy).toHaveTextContent("Discard “Wall dive”?");
    expect(motion.exitOf(copy)).toBeDefined();
  });
});
