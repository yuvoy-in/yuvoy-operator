import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Vocabulary } from "@/lib/services/vocabulary";

/*
  A refused step keeps what was typed (the stability audit, P1-1).

  React resets a form when its action resolves, refusals included, so one
  refused field took every other field on the step back to the saved draft,
  and on Questions it drew every answer type as "A short answer" while the
  state behind it, and the next save, still held what was chosen.
*/

const refusal = { message: "Too short.", fields: ["title"] };
const saveBasics = vi.fn();
const saveSelling = vi.fn();
const saveLocation = vi.fn();
const saveQuestions = vi.fn();
vi.mock("../builder-actions", () => ({
  saveBasics,
  saveSelling,
  saveLocation,
  saveQuestions,
}));

// The map stands in as something that counts how often it was drawn afresh.
let pinMounts = 0;
vi.mock("@/components/map/meeting-pin", () => ({
  MeetingPin: function Pin() {
    const [mount] = useState(() => ++pinMounts);
    return <p>Pin, drawn {mount === 1 ? "once" : `${mount} times`}</p>;
  },
}));

const { BasicsStep } = await import("./basics");
const { SellingStep } = await import("./selling");
const { LocationStep } = await import("./location");
const { QuestionsStep } = await import("./questions");

beforeEach(() => {
  pinMounts = 0;
  for (const save of [saveBasics, saveSelling, saveLocation, saveQuestions]) {
    save.mockReset();
    save.mockResolvedValue(refusal);
  }
});

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: true }), {
    target: { value },
  });

async function next() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
  });
  expect(await screen.findByText("Too short.")).toBeInTheDocument();
}

describe("a refused step", () => {
  it("keeps Basics, the category held in state included", async () => {
    render(
      <BasicsStep
        id="exp_1"
        vocabulary={
          {
            activityTypes: [
              { key: "scuba", label: "Scuba diving", category: "adventure" },
            ],
          } as unknown as Vocabulary
        }
        categories={[
          { value: "adventure", label: "Adventure" },
          { value: "food_drink", label: "Food and drink" },
        ]}
        destinations={[
          { value: "andaman/havelock", label: "Havelock" },
          { value: "andaman/neil", label: "Neil" },
        ]}
        listing={{ title: "Saved name", category: "food_drink" }}
      />,
    );
    type("Name", "Try");
    type("Category", "adventure");
    type("Activity", "scuba");
    type("Where it runs", "andaman/neil");
    type("One line about it", "Your first breath underwater");
    await next();

    expect(screen.getByLabelText("Name", { exact: true })).toHaveValue("Try");
    expect(screen.getByLabelText("Category", { exact: true })).toHaveValue(
      "adventure",
    );
    expect(screen.getByLabelText("Activity", { exact: true })).toHaveValue(
      "scuba",
    );
    expect(screen.getByLabelText("Where it runs", { exact: true })).toHaveValue(
      "andaman/neil",
    );
    expect(
      screen.getByLabelText("One line about it", { exact: true }),
    ).toHaveValue("Your first breath underwater");
  });

  it("keeps Selling's choices and numbers", async () => {
    render(
      <SellingStep
        id="exp_1"
        listing={{
          unitPricePaise: 250000,
          pricingUnit: "per_person",
          maxPartySize: 6,
          durationMinutes: 120,
          bookingMode: "allotment",
        }}
        commissionRateBps={null}
        back="/account/listings/exp_1/edit?step=basics"
      />,
    );
    type("Price", "3000");
    fireEvent.click(screen.getByLabelText("For the group"));
    type("Most people per booking", "8");
    type("How long", "90");
    fireEvent.click(screen.getByLabelText("I answer each request"));
    // Sent with the keyboard's Go from a number field, which keeps the focus.
    const length = screen.getByLabelText("How long", { exact: true });
    length.focus();
    await act(async () => {
      (length as HTMLInputElement).form?.requestSubmit();
    });
    expect(await screen.findByText("Too short.")).toBeInTheDocument();

    expect(screen.getByLabelText("Price", { exact: true })).toHaveValue("3000");
    expect(screen.getByLabelText("For the group")).toBeChecked();
    expect(
      screen.getByLabelText("Most people per booking", { exact: true }),
    ).toHaveValue(8);
    expect(screen.getByLabelText("How long", { exact: true })).toHaveValue(90);
    expect(screen.getByLabelText("I answer each request")).toBeChecked();
  });

  it("keeps Location, the health check included, and never redraws the map", async () => {
    render(
      <LocationStep
        id="exp_1"
        listing={{ meetingPoint: "Jetty 3", meetingLat: null }}
        vocabulary={
          {
            screeners: [{ key: "dive_medical", label: "Diving medical" }],
          } as unknown as Vocabulary
        }
        back="/account/listings/exp_1/edit?step=schedule"
      />,
    );
    type("Where to meet", "Jetty 4, past the fuel pump");
    type("What is included", "Mask\nFins");
    type("Health check before booking", "dive_medical");
    await next();

    expect(screen.getByLabelText("Where to meet", { exact: true })).toHaveValue(
      "Jetty 4, past the fuel pump",
    );
    expect(
      screen.getByLabelText("What is included", { exact: true }),
    ).toHaveValue("Mask\nFins");
    expect(
      screen.getByLabelText("Health check before booking", { exact: true }),
    ).toHaveValue("dive_medical");
    expect(screen.getByText("Pin, drawn once")).toBeInTheDocument();
  });

  it("draws Questions as they were chosen, not as they were saved", async () => {
    render(
      <QuestionsStep
        id="exp_1"
        questions={[
          {
            text: "Can you swim?",
            answerType: "short_text",
            options: [],
            required: false,
          },
        ]}
        back="/account/listings/exp_1/edit?step=location"
      />,
    );
    fireEvent.change(screen.getByDisplayValue("A short answer"), {
      target: { value: "yes_no" },
    });
    fireEvent.click(screen.getByLabelText("They must answer it"));
    await next();

    expect(screen.getByDisplayValue("Yes or no")).toBeInTheDocument();
    expect(screen.getByLabelText("They must answer it")).toBeChecked();
  });
});
