import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

/*
  The two receipts a logo can end in (yuvoy-operator#89 f10).

  "Saved. Your mark is on your listings now." is true only when the API
  applied the mark. On a LIVE business it answers 202 and keeps the old one up
  until somebody has looked, and this screen used to say the first sentence
  about the second case.
*/

const createLogoIntent = vi.fn();
const saveLogo = vi.fn();

vi.mock("./actions", () => ({
  createLogoIntent: () => createLogoIntent(),
  saveLogo: (id: string) => saveLogo(id),
}));

const { LogoUploader } = await import("./logo-uploader");

const PNG = new File([new Uint8Array([137, 80, 78, 71])], "mark.png", {
  type: "image/png",
});

beforeEach(() => {
  createLogoIntent.mockResolvedValue({
    intent: { imageId: "img_1", uploadUrl: "https://images.example/upload" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  createLogoIntent.mockReset();
  saveLogo.mockReset();
});

function choose() {
  fireEvent.change(screen.getByLabelText(/your logo/i), {
    target: { files: [PNG] },
  });
}

describe("the logo's receipt", () => {
  it("says sent for a check, and that the current mark stays up", async () => {
    saveLogo.mockResolvedValue({ inReview: true });
    render(<LogoUploader hasLogo />);

    choose();

    expect(
      await screen.findByText("Sent to us for a check"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your current one stays up/)).toBeInTheDocument();
    expect(screen.queryByText(/on your listings now/)).toBeNull();
    expect(screen.queryByText(/Saved/)).toBeNull();
  });

  it("does not promise a current mark to a business that has none", async () => {
    saveLogo.mockResolvedValue({ inReview: true });
    render(<LogoUploader hasLogo={false} />);

    choose();

    expect(
      await screen.findByText(/It appears there once we have/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/current one/)).toBeNull();
  });

  it("says saved only when the mark was applied", async () => {
    saveLogo.mockResolvedValue({ logoUrl: "https://img/new" });
    render(<LogoUploader hasLogo />);

    choose();

    expect(
      await screen.findByText("Saved. Your mark is on your listings now."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Sent to us for a check")).toBeNull();
  });

  it("lets another be sent from the review receipt", async () => {
    saveLogo.mockResolvedValue({ inReview: true });
    render(<LogoUploader hasLogo />);

    choose();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Send a different one instead",
      }),
    );

    expect(screen.getByLabelText(/your logo/i)).toBeInTheDocument();
    expect(screen.queryByText("Sent to us for a check")).toBeNull();
  });
});
