import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/*
  A refused attach keeps what was chosen (the stability audit, P1-1).

  React resets a form when its action resolves, refusals included. The
  listing is a select, which React reads only when it mounts, so a reset in
  place showed "Choose a listing" under the warning for the one still
  chosen, and "Gallery" went back to "First clip".
*/

const attachMedia = vi.fn();
vi.mock("./actions", () => ({
  attachMedia: (prev: unknown, form: FormData) => attachMedia(prev, form),
}));

const { AttachForm } = await import("./attach-form");

afterEach(() => attachMedia.mockReset());

async function attach() {
  render(
    <AttachForm
      mediaAssetId="med_1"
      listings={[
        { id: "exp_reef", title: "Reef dive", status: "live" },
        { id: "exp_dawn", title: "Dawn snorkel", status: "draft" },
      ]}
    />,
  );
  fireEvent.change(screen.getByLabelText("Listing"), {
    target: { value: "exp_dawn" },
  });
  fireEvent.click(screen.getByLabelText("Gallery"));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Attach/ }));
  });
}

describe("a refused attach", () => {
  it("keeps the listing and the place chosen", async () => {
    attachMedia.mockResolvedValue({
      message: "That clip is not approved yet. The clip was not attached.",
    });
    await attach();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The clip was not attached.",
    );
    expect(screen.getByLabelText("Listing")).toHaveValue("exp_dawn");
    expect(screen.getByLabelText("Gallery")).toBeChecked();
    // The warning still names the listing that is still chosen.
    expect(screen.getByText(/That listing is not on sale/)).toBeInTheDocument();
  });

  it("says no signal in place when the request never came back", async () => {
    attachMedia.mockRejectedValue(new TypeError("Failed to fetch"));
    await attach();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No signal. The clip was not attached. Try again.",
    );
    expect(screen.getByLabelText("Listing")).toHaveValue("exp_dawn");
  });
});
