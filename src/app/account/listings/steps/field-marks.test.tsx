import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { fieldTarget, stepOwning } from "@/lib/services/builder";

vi.mock("../builder-actions", () => ({
  saveLocation: vi.fn(async () => ({})),
  saveSelling: vi.fn(async () => ({})),
  saveBasics: vi.fn(async () => ({})),
}));

const { LocationStep } = await import("./location");
const { FocusOnArrival } = await import("./field-marks");

/*
  yuvoy-operator#85 s10: "let Edit open on that field". It opened on the step
  and nothing said which box was the one: `aria-invalid` came only from a save
  (the audit before release, O12).
*/
describe("a step opened for a field it is still missing", () => {
  function open(flagged?: string) {
    return render(
      <>
        <LocationStep
          id="exp_1"
          listing={{}}
          vocabulary={null}
          back="/account/listings/exp_1/edit?step=schedule"
          flagged={flagged}
        />
        {flagged ? <FocusOnArrival id="l-meeting" /> : null}
      </>,
    );
  }

  it("marks that field in place, in the read-back's words, and focuses it", () => {
    open("meetingPoint");
    const field = screen.getByLabelText("Where to meet");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Still needed");
    expect(field).toHaveFocus();
    // Seen, not only announced.
    expect(field.className).toContain("aria-[invalid=true]:border-terra-deep");
    // Only that field.
    expect(screen.getByLabelText("What to look for")).not.toHaveAttribute(
      "aria-invalid",
    );
    expect(screen.getAllByText("Still needed")).toHaveLength(1);
  });

  it("marks nothing when it was not opened for a missing field", () => {
    open();
    expect(screen.queryByText("Still needed")).toBeNull();
    expect(screen.getByLabelText("Where to meet")).not.toHaveAttribute(
      "aria-invalid",
    );
  });
});

describe("the controls Edit can open on", () => {
  it("are all drawn by their steps, under the ids it looks for", () => {
    // A renamed id would leave Edit focusing nothing, and nothing would fail.
    const dir = join(process.cwd(), "src/app/account/listings/steps");
    const source = ["basics", "selling", "location"]
      .map((step) => readFileSync(join(dir, `${step}.tsx`), "utf8"))
      .join("\n");
    for (const field of [
      "title",
      "category",
      "activityType",
      "destination",
      "summary",
      "description",
      "unitPricePaise",
      "pricingUnit",
      "durationMinutes",
      "maxPartySize",
      "meetingPoint",
      "meetingLandmark",
    ]) {
      const target = fieldTarget(field, stepOwning(field)!);
      expect(source, field).toContain(`id="${target?.inputId}"`);
    }
  });
});
