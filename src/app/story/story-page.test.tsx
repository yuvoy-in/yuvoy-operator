import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
  Your story, after yuvoy-operator#88 s17: "Every field carries two lines of
  helper text, and the page has two headings: 'Your story' and 'In your
  words'. The screen is three fields. It reads as an essay with three fields
  hidden in it ... One heading. Keep the example for About, drop the rest.
  'Preview your operator page' belongs at the top as a button, not as an
  underlined link mid-page."

  The page's one read is replaced; the page, the form and the tiles are real.
*/

const STORY = {
  about: "Two boats and a crew of five, out of Havelock since 2014.",
  languages: ["English", "Hindi"],
  photos: [],
  reviewed: {
    operatingSince: 2014,
    findThemAt: "Beach No. 3, Havelock (Swaraj Dweep)",
    why: "These change through us rather than in place.",
  },
};

/** Mutable, so one test can take the slug away. */
const me: { slug?: string } = {};

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ GET: async () => ({ data: STORY, error: undefined }) }),
}));
vi.mock("./actions", () => ({
  saveStory: vi.fn(),
  createPhotoIntent: vi.fn(),
  addStoryPhoto: vi.fn(),
  removeStoryPhoto: vi.fn(),
}));

const { default: StoryPage } = await import("./page");

async function renderStory() {
  render(await StoryPage());
}

beforeEach(() => {
  me.slug = "reef-divers-havelock";
});

describe("Your story", () => {
  it("has one title, and no second heading over the first field", async () => {
    await renderStory();

    expect(
      screen.getByRole("heading", { level: 1, name: "Your story" }),
    ).toBeInTheDocument();
    /*
      "Photographs" and "Checked by us" stay: they name a different thing
      further down the screen. "In your words" was the title again, in smaller
      type, over the field the title was about.
    */
    expect(
      screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
    ).toEqual(["Photographs", "Checked by us"]);
    expect(screen.queryByText("In your words")).toBeNull();
  });

  it("says nothing that only explains what the screen is", async () => {
    await renderStory();

    // Moved to Help, where somebody who wants it reads it once (#80 t4).
    expect(
      screen.queryByText(/What a traveller reads about your business/),
    ).toBeNull();
    expect(
      screen.queryByText(/registered name and address are separate/),
    ).toBeNull();
    expect(screen.queryByText(/belongs on a listing.s reel/)).toBeNull();
    // What is left of the photograph line is the half that shapes an upload.
    expect(
      screen.getByText("The boat, the shop, the crew. Not the trip itself."),
    ).toBeInTheDocument();
    // And the checked facts keep the way to change them, not the rest.
    expect(
      screen.getByText("To change either, message us."),
    ).toBeInTheDocument();
  });

  it("opens the preview from the top, as a button and not a mid-page link", async () => {
    await renderStory();

    const preview = screen.getByRole("link", {
      name: /Preview your operator page/,
    });
    expect(preview).toHaveAttribute(
      "href",
      "https://app.yuvoy.in/o/reef-divers-havelock",
    );
    // A different product in a different tab, so a half-written story survives.
    expect(preview).toHaveAttribute("target", "_blank");
    expect(preview.getAttribute("rel")).toContain("noreferrer");

    // A button, and never the screen's one primary action: Save is that.
    expect(preview.className).toContain("rounded-full");
    expect(preview.className).toContain("bg-paper-deep");
    expect(preview.className).not.toContain("bg-forest");

    // Above the first field rather than between the fields.
    const about = screen.getByLabelText("About your business");
    expect(
      preview.compareDocumentPosition(about) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws no preview at all when the API sent no slug", async () => {
    /*
      Required in a pinned contract is a promise about master, not about the
      deployed API. A button whose href is `/o/undefined` leads to nothing, or
      to somebody else's page; no button is better than that.
    */
    delete me.slug;
    await renderStory();

    expect(
      screen.queryByRole("link", { name: /Preview your operator page/ }),
    ).toBeNull();
  });
});
