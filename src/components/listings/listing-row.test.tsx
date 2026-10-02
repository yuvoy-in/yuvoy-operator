import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorExperience } from "@/lib/services/listings";

const submitRevision = vi.fn();

vi.mock("./actions", () => ({
  submitRevision: (prev: unknown, form: FormData) => submitRevision(prev, form),
}));
// Tested where it lives; here it only has to stay out of the way.
vi.mock("./pause-resume", () => ({ PauseResume: () => null }));

const { ListingRow } = await import("./listing-row");

afterEach(() => submitRevision.mockReset());

const LIVE: OperatorExperience = {
  id: "exp_reef",
  title: "Reef dive",
  summary: "Two tanks on the house reef",
  description: "We meet, we kit up, we dive.",
  status: "live",
  publicationState: "published",
  meetingPoint: "Beach 3 dive hut",
  unitPricePaise: 450000,
  pricingUnit: "per_person",
  durationMinutes: 180,
  maxPartySize: 6,
  inclusions: ["Mask and fins", "One guided dive"],
  requirements: ["Able to swim 50m"],
  safetyNotes: "Two guides in the water on every dive.",
};

function renderRow() {
  render(
    <ul>
      <ListingRow listing={LIVE} hasFootage vocabulary={null} />
    </ul>,
  );
  return within(screen.getByRole("listitem"));
}

/*
  D-032.3. What the operator owns goes live at once and the rest is read
  first. The row sent every field on every edit and then said "with us" to
  all of it, including a price that was already live.
*/
describe("a change to a live listing", () => {
  it("sends only the fields that changed", async () => {
    submitRevision.mockResolvedValue({
      outcome: { applied: ["unitPricePaise"], inReview: [] },
    });
    const user = userEvent.setup();
    const row = renderRow();

    await user.click(row.getByRole("button", { name: "Propose a change" }));
    const price = row.getByLabelText("Price");
    await user.clear(price);
    await user.type(price, "5000");
    await user.click(row.getByRole("button", { name: "Send it to us" }));

    expect(submitRevision).toHaveBeenCalledTimes(1);
    const sent: FormData = submitRevision.mock.calls[0][1];
    expect([...sent.entries()]).toEqual([
      ["id", "exp_reef"],
      ["unitPrice", "5000"],
    ]);
  });

  it("says before sending which half goes live at once", async () => {
    const user = userEvent.setup();
    const row = renderRow();

    await user.click(row.getByRole("button", { name: "Propose a change" }));

    expect(row.getByText(/does not take it off sale/i)).toHaveTextContent(
      "Price, duration, group size and where to meet change at once",
    );
    expect(row.getByText(/keeps what they booked on/i)).toBeInTheDocument();
  });

  it("names what is live now and what is with us, in the API's words", async () => {
    submitRevision.mockResolvedValue({
      outcome: {
        applied: ["unitPricePaise", "meetingPoint"],
        inReview: ["description"],
        next: "The first list is live now. We read the second, and the listing keeps selling on the old wording meanwhile.",
        note: "Bookings already made are unaffected: they keep the price and terms they were made on.",
      },
    });
    const user = userEvent.setup();
    const row = renderRow();

    await user.click(row.getByRole("button", { name: "Propose a change" }));
    await user.type(row.getByLabelText("What happens on the day"), " Twice.");
    await user.click(row.getByRole("button", { name: "Send it to us" }));

    const answer = await row.findByRole("status");
    expect(answer).toHaveTextContent(
      "The first list is live now. We read the second",
    );
    // The API's order: the operator's half, then ours.
    expect(answer).toHaveTextContent(
      /Live now: Price, Where to meet.*With us: What happens on the day/,
    );
    expect(answer).toHaveTextContent("Bookings already made are unaffected");
    expect(answer).not.toHaveTextContent(/saved/i);
  });

  it("does not say with us when everything went live", async () => {
    submitRevision.mockResolvedValue({
      outcome: { applied: ["maxPartySize"], inReview: [] },
    });
    const user = userEvent.setup();
    const row = renderRow();

    await user.click(row.getByRole("button", { name: "Propose a change" }));
    const party = row.getByLabelText("Most people per booking");
    await user.clear(party);
    await user.type(party, "8");
    await user.click(row.getByRole("button", { name: "Send it to us" }));

    const answer = await row.findByRole("status");
    expect(answer).toHaveTextContent("These are live now.");
    expect(answer).toHaveTextContent("Live now: Most people per booking");
    expect(answer).not.toHaveTextContent(/with us/i);
  });

  it("falls back to its own sentence for an answer that names no halves", async () => {
    submitRevision.mockResolvedValue({
      outcome: { applied: [], inReview: [] },
    });
    const user = userEvent.setup();
    const row = renderRow();

    await user.click(row.getByRole("button", { name: "Propose a change" }));
    await user.type(row.getByLabelText("Safety notes"), " Always.");
    await user.click(row.getByRole("button", { name: "Send it to us" }));

    expect(await row.findByRole("status")).toHaveTextContent(
      "Your change is with us. It stays on sale on the old terms until we answer.",
    );
  });
});
