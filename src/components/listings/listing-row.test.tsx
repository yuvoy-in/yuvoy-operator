import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OperatorExperience } from "@/lib/services/listings";
import type { Vocabulary } from "@/lib/services/vocabulary";

const submitRevision = vi.fn();

vi.mock("./actions", () => ({
  submitRevision: (prev: unknown, form: FormData) => submitRevision(prev, form),
}));
// Tested where it lives; here it only has to stay out of the way.
vi.mock("./pause-resume", () => ({ PauseResume: () => null }));
// The map itself never loads here; the pin's other ways in are the test.
vi.mock("next/dynamic", () => ({ default: () => () => null }));

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

/*
  yuvoy-operator#113. Every listing on sale is past the builder, so the live
  edit is where one gets a pin. An untouched pin is not a change, and a moved
  one goes as both numbers.
*/
describe("the pin on a live listing", () => {
  const PINNED: OperatorExperience = {
    ...LIVE,
    meetingLat: 11.9695,
    meetingLng: 92.9631,
  };

  function renderPinned(listing: OperatorExperience = PINNED) {
    render(
      <ul>
        <ListingRow listing={listing} hasFootage vocabulary={null} />
      </ul>,
    );
    return within(screen.getByRole("listitem"));
  }

  it("is not offered by an API from before pins", async () => {
    const user = userEvent.setup();
    const row = renderRow();
    await user.click(row.getByRole("button", { name: "Propose a change" }));
    expect(row.queryByRole("group", { name: "Pin on the map" })).toBeNull();
  });

  it("does not send a pin nobody moved", async () => {
    submitRevision.mockResolvedValue({
      outcome: { applied: ["maxPartySize"], inReview: [] },
    });
    const user = userEvent.setup();
    const row = renderPinned();

    await user.click(row.getByRole("button", { name: "Propose a change" }));
    const party = row.getByLabelText("Most people per booking");
    await user.clear(party);
    await user.type(party, "8");
    await user.click(row.getByRole("button", { name: "Send it to us" }));

    const sent: FormData = submitRevision.mock.calls[0][1];
    expect([...sent.keys()]).toEqual(["id", "maxPartySize"]);
  });

  it("sends a removed pin as both fields empty", async () => {
    submitRevision.mockResolvedValue({
      outcome: { applied: ["meetingLat", "meetingLng"], inReview: [] },
    });
    const user = userEvent.setup();
    const row = renderPinned();

    await user.click(row.getByRole("button", { name: "Propose a change" }));
    await user.click(row.getByRole("button", { name: "Remove the pin" }));
    await user.click(row.getByRole("button", { name: "Send it to us" }));

    const sent: FormData = submitRevision.mock.calls[0][1];
    expect([...sent.entries()]).toEqual([
      ["id", "exp_reef"],
      ["meetingLat", ""],
      ["meetingLng", ""],
    ]);
    expect(await row.findByRole("status")).toHaveTextContent(
      "Live now: Pin on the map",
    );
  });

  it("offers a pin to a live listing that has none yet", async () => {
    const user = userEvent.setup();
    const row = renderPinned({ ...LIVE, meetingLat: null, meetingLng: null });
    await user.click(row.getByRole("button", { name: "Propose a change" }));
    expect(row.getByRole("group", { name: "Pin on the map" })).toBeVisible();
    expect(row.getByText("No pin yet.")).toBeVisible();
  });
});

/*
  The stability audit, P1-1. React resets a form when its action resolves,
  refusals included, so one refused field took all twelve back to what was on
  file, and the operator typed the change again from the top.
*/
describe("a refused change", () => {
  it("keeps every field as it was typed, and still sends only what changed", async () => {
    submitRevision.mockResolvedValue({
      message: "Most people per booking must be at least 1.",
    });
    const user = userEvent.setup();
    render(
      <ul>
        <ListingRow
          listing={{ ...LIVE, category: "adventure", activityType: "snorkel" }}
          hasFootage
          vocabulary={
            {
              activityTypes: [
                { key: "snorkel", label: "Snorkelling", category: "adventure" },
                { key: "scuba", label: "Scuba diving", category: "adventure" },
              ],
            } as unknown as Vocabulary
          }
        />
      </ul>,
    );
    const row = within(screen.getByRole("listitem"));

    await user.click(row.getByRole("button", { name: "Propose a change" }));
    await user.clear(row.getByLabelText("Name"));
    await user.type(row.getByLabelText("Name"), "Reef dive, two tanks");
    await user.selectOptions(row.getByLabelText("Activity"), "scuba");
    await user.clear(row.getByLabelText("Price"));
    await user.type(row.getByLabelText("Price"), "5000");
    await user.click(row.getByLabelText(/For the group/));
    await user.clear(row.getByLabelText("Most people per booking"));
    await user.type(row.getByLabelText("Most people per booking"), "0");
    await user.click(row.getByRole("button", { name: "Send it to us" }));

    expect(
      await row.findByText("Most people per booking must be at least 1."),
    ).toBeInTheDocument();
    expect(row.getByLabelText("Name")).toHaveValue("Reef dive, two tanks");
    expect(row.getByLabelText("Activity")).toHaveValue("scuba");
    expect(row.getByLabelText("Price")).toHaveValue("5000");
    expect(row.getByLabelText(/For the group/)).toBeChecked();
    expect(row.getByLabelText("Most people per booking")).toHaveValue("0");
    // Untouched, and still what is on file.
    expect(row.getByLabelText("What happens on the day")).toHaveValue(
      LIVE.description,
    );

    await user.clear(row.getByLabelText("Most people per booking"));
    await user.type(row.getByLabelText("Most people per booking"), "8");
    await user.click(row.getByRole("button", { name: "Send it to us" }));
    const sent: FormData = submitRevision.mock.calls[1][1];
    expect(Object.fromEntries(sent.entries())).toEqual({
      id: "exp_reef",
      title: "Reef dive, two tanks",
      activityType: "scuba",
      unitPrice: "5000",
      pricingUnit: "per_group",
      maxPartySize: "8",
    });
  });

  it("says no signal on the row when the request never came back", async () => {
    submitRevision.mockRejectedValue(new TypeError("Failed to fetch"));
    const user = userEvent.setup();
    const row = renderRow();

    await user.click(row.getByRole("button", { name: "Propose a change" }));
    await user.clear(row.getByLabelText("Price"));
    await user.type(row.getByLabelText("Price"), "5000");
    await user.click(row.getByRole("button", { name: "Send it to us" }));

    expect(
      await row.findByText("No signal. Nothing was sent. Try again."),
    ).toBeInTheDocument();
    expect(row.getByLabelText("Price")).toHaveValue("5000");
  });
});
