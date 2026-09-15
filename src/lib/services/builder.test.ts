import { describe, expect, it } from "vitest";
import {
  STEPS,
  STEP_LABEL,
  openingStep,
  nextStep,
  previousStep,
  readStep,
  stepOwning,
  unfinishedSteps,
} from "./builder";

describe("readStep", () => {
  it("takes a step the URL names", () => {
    expect(readStep("selling")).toBe("selling");
    expect(readStep("review")).toBe("review");
  });

  it("falls back to the first step rather than trusting the URL", () => {
    // A hand-typed or stale `?step=` must not produce a screen with no form.
    expect(readStep("pricing")).toBe("basics");
    expect(readStep(undefined)).toBe("basics");
    expect(readStep("")).toBe("basics");
  });
});

describe("moving between steps", () => {
  it("walks the seven in order and stops at both ends", () => {
    expect(nextStep("basics")).toBe("selling");
    expect(nextStep("review")).toBeNull();
    expect(previousStep("basics")).toBeNull();
    expect(previousStep("review")).toBe("media");
  });

  it("labels every step, so none can be drawn nameless", () => {
    for (const step of STEPS) {
      expect(STEP_LABEL[step]).toBeTruthy();
    }
  });
});

describe("which step owns a blocker", () => {
  it("puts each field on the step that has its control", () => {
    expect(stepOwning("summary")).toBe("basics");
    expect(stepOwning("activityType")).toBe("basics");
    expect(stepOwning("unitPricePaise")).toBe("selling");
    expect(stepOwning("pricingUnit")).toBe("selling");
    expect(stepOwning("meetingPoint")).toBe("location");
  });

  it("owns nothing it has no control for", () => {
    /*
      A field this build has not heard of must mark NO step unfinished. Marking
      one sends an operator round a form looking for a control that is not
      there, which is worse than the silence.
    */
    expect(stepOwning("somethingNew")).toBeNull();
    expect(unfinishedSteps(["somethingNew"]).size).toBe(0);
  });

  it("collects every step still holding something", () => {
    const steps = unfinishedSteps([
      "summary",
      "unitPricePaise",
      "meetingPoint",
    ]);
    expect([...steps].sort()).toEqual(["basics", "location", "selling"]);
  });
});

describe("openingStep", () => {
  it("opens the EARLIEST gap, not the first one the API named", () => {
    // The API lists blockers in its own order; an operator reopening a draft
    // should meet the earliest gap.
    expect(openingStep(["meetingPoint", "summary"])).toBe("basics");
    expect(openingStep(["meetingPoint", "unitPricePaise"])).toBe("selling");
  });

  it("opens Review when nothing is missing", () => {
    expect(openingStep([])).toBe("review");
  });

  it("opens Review when the only blockers belong to no step", () => {
    expect(openingStep(["somethingNew"])).toBe("review");
  });
});
