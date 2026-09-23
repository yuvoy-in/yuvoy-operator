import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { STEPS, type Step } from "@/lib/services/builder";
import { Stepper } from "./stepper";

/*
  Seven chips wrapping over two rows, each shouting "1. Basics"
  (yuvoy-operator#85 s11). It is one sentence over one thin bar now, and the
  bar still has to carry everything the chips did: which step is open, which
  one is still missing something, and a way into each.
*/

function stepper(
  current: Step = "basics",
  unfinished: Step[] = [],
  id = "exp_1",
) {
  return render(
    <Stepper id={id} current={current} unfinished={new Set(unfinished)} />,
  );
}

describe("where you are in the builder", () => {
  it("says the step, its number and how many there are", () => {
    stepper("basics");
    expect(screen.getByText("Step 1 of 7 · Basics")).toBeVisible();
  });

  it("counts in step order, not in the order a gap was found", () => {
    stepper("location");
    expect(screen.getByText("Step 4 of 7 · Location and safety")).toBeVisible();
  });

  it("gives every step a link of its own", () => {
    stepper();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(STEPS.length);
    STEPS.forEach((step, i) => {
      expect(links[i]).toHaveAttribute(
        "href",
        `/account/listings/exp_1/edit?step=${step}`,
      );
    });
  });

  it("marks one step as the open one, and names each for a reader", () => {
    stepper("selling");
    const open = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "step");

    expect(open).toHaveLength(1);
    expect(open[0]).toHaveAccessibleName("Step 2, Selling");
    // The name is for a screen reader; the bar is what anybody else sees.
    expect(open[0].querySelector(".sr-only")).toHaveTextContent(
      "Step 2, Selling",
    );
  });

  it("marks a step that is still missing something by more than colour", () => {
    stepper("selling", ["basics"]);

    const short = screen.getByRole("link", { name: /^Step 1, Basics/ });
    expect(short).toHaveAccessibleName(
      "Step 1, Basics, still missing something",
    );
    expect(short.querySelector(".size-1")).toHaveClass("bg-terra-deep");

    // And a step with nothing outstanding carries neither the words nor a dot.
    const fine = screen.getByRole("link", { name: "Step 2, Selling" });
    expect(fine.querySelector(".size-1")).not.toHaveClass("bg-terra-deep");
  });

  it("says what a dot means, but only when one is drawn", () => {
    stepper("basics", ["media"]);
    expect(screen.getByText(/A dot marks a step still missing/)).toBeVisible();
  });

  it("says nothing about dots when every step is complete", () => {
    stepper("review");
    expect(screen.queryByText(/A dot marks a step/)).toBeNull();
  });

  it("draws the seven before a draft exists, and none of them go anywhere", () => {
    stepper("basics", [], "");
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getAllByRole("listitem")).toHaveLength(STEPS.length);
    expect(screen.getByText("Step 1, Basics")).toBeVisible();
  });
});
