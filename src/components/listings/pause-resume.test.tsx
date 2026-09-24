import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const pauseListing = vi.fn();
const resumeListing = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/today/listing/exp_snorkel",
}));
vi.mock("./actions", () => ({
  pauseListing: (prev: unknown, form: FormData) => pauseListing(prev, form),
  resumeListing: (prev: unknown, form: FormData) => resumeListing(prev, form),
}));

const { PauseResume } = await import("./pause-resume");

beforeEach(() => {
  pauseListing.mockReset().mockResolvedValue({});
  resumeListing.mockReset().mockResolvedValue({});
});

function control(publicationState: string | undefined = "published") {
  return render(
    <PauseResume
      experienceId="exp_snorkel"
      title="Snorkel trip at Coral Bay"
      publicationState={publicationState}
    />,
  );
}

/*
  Taking a listing off sale is destructive (yuvoy-operator#81), so Pause is
  text in the warning colour rather than a pill beside Edit, and the button
  that pauses carries the loud one. What pausing does NOT do was two
  paragraphs above the button; it is one sentence and a help link now (#80 t4).
*/
describe("the control that takes a listing off sale", () => {
  it("is quiet, and does not explain itself on the screen", () => {
    const { container } = control();

    const pause = screen.getByRole("button", { name: "Pause" });
    expect(pause).toHaveClass("text-terra-deep");
    expect(pause).not.toHaveClass("border-2");
    expect(pause).not.toHaveClass("bg-forest");

    expect(container.textContent).not.toContain("Anybody already booked");
    expect(
      screen.getByRole("link", { name: "What pausing does" }),
    ).toHaveAttribute(
      "href",
      "/account/help?from=%2Ftoday%2Flisting%2Fexp_snorkel#pausing-a-listing",
    );
  });

  it("asks with the listing's name, and the one sentence that changes it", () => {
    control();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(
      screen.getByText(
        "Pause Snorkel trip at Coral Bay? It stops new bookings. It does not cancel the ones you have, and those travellers still expect their trip.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause it" })).toHaveClass(
      "border-2",
      "border-terra-deep",
    );
    // The id is typed, not ticked: one mis-tap on a wet phone is not enough.
    expect(
      screen.getByLabelText(/Type this listing’s id to confirm/),
    ).toBeInTheDocument();
  });

  it("puts the control back when the question goes unanswered", () => {
    control();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(pauseListing).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Pause" })).toBeVisible();
  });

  it("sends the reason, the note and the typed id", () => {
    control();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(
      screen.getByRole("radio", { name: "Not running this at the moment" }),
    );
    fireEvent.change(screen.getByLabelText("Anything to add"), {
      target: { value: "Engine out until October." },
    });
    fireEvent.change(screen.getByLabelText(/Type this listing’s id/), {
      target: { value: "exp_snorkel" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause it" }));

    const sent = pauseListing.mock.calls[0][1] as FormData;
    expect(sent.get("id")).toBe("exp_snorkel");
    expect(sent.get("reasonCode")).toBe("not_running");
    expect(sent.get("note")).toBe("Engine out until October.");
    expect(sent.get("confirmExperienceId")).toBe("exp_snorkel");
  });

  /*
    A draft sells nothing to pause, and a listing waiting on its first approval
    has been submitted and has no switch either way. Neither gets a sentence
    about it: not offering a control already says it.
  */
  it("draws nothing at all for a listing that is not on sale yet", () => {
    for (const state of ["draft", "in_review", undefined]) {
      const { container, unmount } = render(
        <PauseResume
          experienceId="exp_snorkel"
          title="Snorkel trip at Coral Bay"
          publicationState={state}
        />,
      );
      expect(container).toBeEmptyDOMElement();
      unmount();
    }
  });
});

describe("the receipt after pausing", () => {
  /*
    The receipt must outlive the re-read that turns the listing Paused, so the
    component is always mounted and keeps its answer in action state.
  */
  it("says what it did and did not do, and survives the re-read", async () => {
    pauseListing.mockResolvedValue({
      done: {
        upcomingDepartures: 4,
        bookingsToHonour: 2,
        guestsToHonour: 5,
        note: "2 bookings are unchanged and those trips still run.",
        next: "Resume on the listing puts it back straight away.",
      },
    });
    const { rerender } = control();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause it" }));

    expect(await screen.findByText("Paused")).toBeInTheDocument();
    expect(
      screen.getByText(/4 upcoming departures have stopped being offered\./),
    ).toHaveTextContent("Nothing was cancelled and nothing was refunded.");
    // The API's own sentences, verbatim, both of them.
    expect(
      screen.getByText("2 bookings are unchanged and those trips still run."),
    ).toBeVisible();
    expect(
      screen.getByText("Resume on the listing puts it back straight away."),
    ).toBeVisible();

    // What the re-read passes down: the listing is withdrawn now.
    rerender(
      <PauseResume
        experienceId="exp_snorkel"
        title="Snorkel trip at Coral Bay"
        publicationState="withdrawn"
      />,
    );
    expect(screen.getByText("Paused")).toBeInTheDocument();
  });

  it("says it in our own words when the API sends none", async () => {
    pauseListing.mockResolvedValue({
      done: { upcomingDepartures: 1, bookingsToHonour: 0, guestsToHonour: 0 },
    });
    control();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause it" }));

    expect(
      await screen.findByText(/One upcoming departure has stopped being/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Resume it here whenever you are ready/),
    ).toBeVisible();
  });
});

/*
  `409 sale_in_progress`: somebody holds unpaid seats on the listing, or a
  request on it is waiting. The refusal names the wait, and the form comes back
  with what was typed rather than empty.
*/
describe("a pause the API refuses", () => {
  it("names the wait and keeps what was typed", async () => {
    pauseListing.mockResolvedValue({
      message:
        "Somebody holds unpaid seats on this listing until 14:41. You can pause it after that. Nothing changed.",
      typed: { reasonCode: "price_wrong", confirmExperienceId: "exp_snorkel" },
      attempt: 1,
    });
    control();
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    fireEvent.click(screen.getByRole("button", { name: "Pause it" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Somebody holds unpaid seats on this listing until 14:41. You can pause it after that. Nothing changed.",
    );
    // The form is still open, with the answers the operator already gave.
    expect(
      screen.getByRole("radio", { name: "The price is wrong" }),
    ).toBeChecked();
    expect(screen.getByLabelText(/Type this listing’s id/)).toHaveValue(
      "exp_snorkel",
    );
  });
});

describe("putting a listing back on sale", () => {
  it("is armed by one tap and sent by a second", async () => {
    resumeListing.mockResolvedValue({
      done: { state: "published", next: "It is back on sale." },
    });
    control("withdrawn");

    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    expect(
      screen.getByText("Put Snorkel trip at Coral Bay back on sale?"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Yes, resume it" }));
    expect(await screen.findByText("Resumed")).toBeInTheDocument();
    expect(screen.getByText("It is back on sale.")).toBeVisible();
  });

  it("does not claim a listing awaiting its first check is selling", async () => {
    resumeListing.mockResolvedValue({ done: { state: "in_review" } });
    control("withdrawn");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, resume it" }));

    expect(
      await screen.findByText("Still waiting for its first approval"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Resumed")).toBeNull();
  });

  it("says what is missing, and stays paused", async () => {
    resumeListing.mockResolvedValue({
      message: "Still missing: where to meet. It is still paused.",
    });
    control("withdrawn");
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, resume it" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Still missing: where to meet. It is still paused.",
    );
  });
});
