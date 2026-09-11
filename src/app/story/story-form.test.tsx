import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { StoryForm } from "./story-form";

vi.mock("./actions", () => ({ saveStory: vi.fn(async () => ({})) }));

const WRITTEN = "Two boats and a crew of five, out of Havelock since 2014.";

describe("writing the story — yuvoy-operator#41", () => {
  it("starts from what travellers already see", () => {
    render(<StoryForm about={WRITTEN} languages={["English", "Hindi"]} />);
    expect(screen.getByLabelText("About your business")).toHaveValue(WRITTEN);
    expect(screen.getByLabelText("Languages your crew speaks")).toHaveValue(
      "English, Hindi",
    );
  });

  it("will not send two words", () => {
    // "Two words on a trust surface is worse than an honest blank."
    render(<StoryForm about="" languages={[]} />);
    fireEvent.change(screen.getByLabelText("About your business"), {
      target: { value: "We dive." },
    });
    expect(screen.getByText("8 of 600")).toBeInTheDocument();
    expect(screen.getByText(/At least 40 characters/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("sends an empty story, which clears it", () => {
    render(<StoryForm about={WRITTEN} languages={[]} />);
    fireEvent.change(screen.getByLabelText("About your business"), {
      target: { value: "   " },
    });
    expect(screen.getByText(/Empty is fine/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("counts the way the API counts, and says why that runs ahead of the typing", () => {
    render(<StoryForm about="" languages={[]} />);
    // Forty letters; the apostrophe a phone types is three bytes, so 42.
    fireEvent.change(screen.getByLabelText("About your business"), {
      target: { value: "We’re out past the reef by seven, daily." },
    });
    expect(screen.getByText("42 of 600")).toBeInTheDocument();
    expect(screen.getByText(/counts faster than you type/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("refuses a ninth language before sending it", () => {
    render(<StoryForm about="" languages={[]} />);
    fireEvent.change(screen.getByLabelText("Languages your crew speaks"), {
      target: { value: "A, B, C, D, E, F, G, H, I" },
    });
    expect(screen.getByText(/8 languages at most/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
