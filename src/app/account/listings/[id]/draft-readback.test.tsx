import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { DraftListing } from "@/lib/services/draft";
import { DraftReadback } from "./draft-readback";

/*
  A draft listing, drawn as it stands (yuvoy-operator#85 s10). The screen said
  "Still missing: a short summary, a price, where to meet" and nothing about
  what the listing actually said, cost, or would look like.
*/

const LISTING: DraftListing = {
  title: "Try-dive at Nemo Reef",
  summary: "A first dive off the boat.",
  activityTypeLabel: "Scuba diving",
  unitPricePaise: 450000,
  pricingUnit: "per_person",
  durationMinutes: 180,
  maxPartySize: 6,
  meetingPoint: "Beach 3 dive hut",
  publishBlockers: [],
};

function readback(over: Partial<DraftListing> = {}, editable = true) {
  return render(
    <DraftReadback
      id="exp_1"
      listing={{ ...LISTING, ...over }}
      mediaCount={2}
      editable={editable}
      categoryLabel="Adventure"
      destinationLabel="Havelock (Swaraj Dweep)"
    />,
  );
}

/** One field's row, found by the label it leads with. */
function row(label: string) {
  return screen.getByText(label).closest("li") as HTMLElement;
}

describe("a draft as it stands", () => {
  it("shows what it says, what it costs and how it will look", () => {
    readback();

    for (const heading of [
      "What it says",
      "What it costs",
      "Where it meets",
      "How it will look",
    ]) {
      expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    }

    expect(row("Name")).toHaveTextContent("Try-dive at Nemo Reef");
    expect(row("Price")).toHaveTextContent("₹4,500");
    expect(row("That price is")).toHaveTextContent("Per person");
    expect(row("Where to meet")).toHaveTextContent("Beach 3 dive hut");
    expect(row("Photographs and clips")).toHaveTextContent("2 on it");
  });

  it("marks a missing field in place, and nothing else", () => {
    readback({
      summary: "",
      publishBlockers: ["summary", "meetingPoint"],
    });

    expect(
      within(row("One line about it")).getByText("Still needed"),
    ).toBeVisible();
    expect(
      within(row("Where to meet")).getByText("Still needed"),
    ).toBeVisible();
    expect(screen.getAllByText("Still needed")).toHaveLength(2);
    expect(row("Name")).toHaveTextContent("Try-dive at Nemo Reef");
  });

  /*
    Empty and blocking nothing is a worse listing, not an unpublishable one, so
    it says so without the warning colour.
  */
  it("says an empty field that blocks nothing without the warning", () => {
    readback({ description: "" });
    expect(
      within(row("What happens on the day")).getByText("Nothing yet"),
    ).toBeVisible();
    expect(screen.queryByText("Still needed")).toBeNull();
  });

  it("sends each row to the builder step that answers it", () => {
    readback({ publishBlockers: ["unitPricePaise"] });

    expect(within(row("Name")).getByRole("link")).toHaveAttribute(
      "href",
      "/account/listings/exp_1/edit?step=basics",
    );
    expect(within(row("Price")).getByRole("link")).toHaveAttribute(
      "href",
      "/account/listings/exp_1/edit?step=selling",
    );
    expect(within(row("Where to meet")).getByRole("link")).toHaveAttribute(
      "href",
      "/account/listings/exp_1/edit?step=location",
    );
  });

  it("sends a field it has no step for to the builder's own choice", () => {
    readback({ publishBlockers: ["whatTheBoatIsCalled"] });
    expect(
      within(row("WhatTheBoatIsCalled")).getByRole("link"),
    ).toHaveAttribute("href", "/account/listings/exp_1/edit");
  });

  /*
    A staff login is refused by the builder (#58), so its rows are rows. A link
    into a screen that turns somebody away is worse than no link.
  */
  it("gives a login that cannot edit the facts and no way in", () => {
    readback({}, false);

    expect(row("Name")).toHaveTextContent("Try-dive at Nemo Reef");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});
