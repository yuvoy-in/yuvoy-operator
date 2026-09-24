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
    /*
      The count answers this now, at every length including none. It used to
      give way to "Empty is fine. Nothing shows on your page until you write
      something", a third helper line on a field that says the same thing by
      letting Save through (yuvoy-operator#88 s17).
    */
    expect(screen.getByText("0 of 600")).toBeInTheDocument();
    expect(screen.queryByText(/Empty is fine/)).toBeNull();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("keeps the example that shapes what gets written, and nothing else", () => {
    /*
      #88 s17: "Keep the example for About (it genuinely shapes what people
      write), drop the rest." What a traveller does with it afterwards, and why
      the languages matter, are answers in Help (#80 t4).
    */
    render(<StoryForm about="" languages={[]} />);

    expect(
      screen.getByText(/Who you are, how long you have been at it/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Travellers read this before they book/),
    ).toBeNull();
    expect(screen.queryByText(/Separate them with commas/)).toBeNull();
    expect(screen.queryByText(/nervous in the water/)).toBeNull();
  });

  it("shows the languages example in the field, where it leaves when typed", () => {
    render(<StoryForm about="" languages={[]} />);
    const languages = screen.getByLabelText("Languages your crew speaks");

    expect(languages).toHaveAttribute("placeholder", "English, Hindi, Bengali");
    // Nothing describes it until something is wrong with what was typed.
    expect(languages).not.toHaveAttribute("aria-describedby");

    fireEvent.change(languages, {
      target: { value: "A, B, C, D, E, F, G, H, I" },
    });
    expect(languages).toHaveAttribute("aria-describedby", "languages-problem");
    expect(languages).toHaveAttribute("aria-invalid", "true");
  });

  it("counts the way the API counts, which is now the letters typed", () => {
    /*
      It counted BYTES, because the API did — so this same sentence read "42 of
      600" for forty characters, and the screen carried a line excusing it.
      Both are gone: the API counts characters (yuvoy-operator#41), and a count
      that disagrees with the letters on screen is the one thing a counter must
      never do.
    */
    render(<StoryForm about="" languages={[]} />);
    const text = "We’re out past the reef by seven, daily.";
    expect([...text]).toHaveLength(40);

    fireEvent.change(screen.getByLabelText("About your business"), {
      target: { value: text },
    });
    expect(screen.getByText("40 of 600")).toBeInTheDocument();
    expect(screen.queryByText(/counts faster than you type/)).toBeNull();
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
