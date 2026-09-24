import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StepShell } from "./step-shell";

/*
  yuvoy-operator#80 t2 and #85 s11: every step said its name twice, "Step 1 of
  7 · Basics" and then "Basics" again in large type, with a line under it
  describing the step. One title, and only the sentence that changes a
  decision (the audit before release, O13).
*/
describe("a builder step's frame", () => {
  it("names the step for a screen reader only, and describes nothing", () => {
    render(
      <StepShell title="Basics" action={() => {}} pending={false}>
        <input aria-label="Name" />
      </StepShell>,
    );
    expect(screen.getByRole("heading", { name: "Basics" })).toHaveClass(
      "sr-only",
    );
    expect(screen.queryByText(/What it is, where it runs/)).toBeNull();
  });

  it("keeps a sentence that changes what somebody does", () => {
    render(
      <StepShell
        title="Questions"
        blurb="You can leave this empty."
        action={() => {}}
        pending={false}
      >
        <input aria-label="Question" />
      </StepShell>,
    );
    expect(screen.getByText("You can leave this empty.")).toBeVisible();
  });
});
