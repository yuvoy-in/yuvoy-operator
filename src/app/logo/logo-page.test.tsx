import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

/*
  The logo screen, after yuvoy-operator#80 t2 and t4: "one title per screen"
  and "cut every sentence that explains what the screen is. Keep only the
  sentence that changes a decision ... Move the rest into a single help entry
  under the gear."

  It opened with an eyebrow, repeated its own title as a caption in the bar,
  and then said where travellers see a logo. What stays is the sentence that
  stops somebody uploading the same mark twice.

  The page's two reads are replaced; the page and the uploader are real.
*/

const me = { canManage: true };

vi.mock("@/lib/auth/session", () => ({
  requireOperator: async () => ({ token: "tok", me }),
}));
vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({
    GET: async () => ({
      data: { imageId: "img_1", logoUrl: "https://images.test/mark.png" },
      error: undefined,
    }),
  }),
}));
vi.mock("@/lib/money/fetch", () => ({ getChangeRequests: async () => [] }));
vi.mock("./actions", () => ({
  createLogoIntent: vi.fn(),
  saveLogo: vi.fn(),
}));

const { default: LogoPage } = await import("./page");

describe("Your logo", () => {
  it("leads with its title, with nothing above it and no caption repeating it", async () => {
    const { container } = render(await LogoPage());

    expect(
      screen.getByRole("heading", { level: 1, name: "Your logo" }),
    ).toBeInTheDocument();
    expect(container.querySelector(".eyebrow")).toBeNull();
    // The stage caption lives in the screen's header, and there is none.
    expect(container.querySelector("header p")).toBeNull();
  });

  it("keeps the sentence that stops a second upload, and moves the rest to Help", async () => {
    render(await LogoPage());

    expect(
      screen.getByText(/we look at a new logo before it replaces/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/on a card with no clip/)).toBeNull();
    expect(
      screen.getByRole("link", { name: "Where travellers see your logo" }),
    ).toHaveAttribute("href", "/account/help#where-logo-appears");
  });
});
