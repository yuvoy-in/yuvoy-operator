import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { Vocabulary } from "@/lib/services/vocabulary";

vi.mock("../builder-actions", () => ({
  saveBasics: vi.fn(async () => ({})),
  saveSelling: vi.fn(async () => ({})),
  saveLocation: vi.fn(async () => ({})),
}));

const { BasicsStep } = await import("./basics");
const { SellingStep } = await import("./selling");
const { LocationStep } = await import("./location");

const VOCABULARY = {
  activityTypes: [
    { key: "scuba", label: "Scuba diving", category: "adventure" },
  ],
} as unknown as Vocabulary;

function basics() {
  return render(
    <BasicsStep
      id="exp_1"
      vocabulary={VOCABULARY}
      categories={[{ value: "adventure", label: "Adventure" }]}
      destinations={[{ value: "andaman/havelock", label: "Havelock" }]}
      /*
        A category already chosen, so the activity picker is drawn: it is the
        field with the longest reason, and the one most worth folding.
      */
      listing={{ category: "adventure" }}
    />,
  );
}

/** Words an operator reads without opening anything: not the pickers' options. */
function visibleWords(form: HTMLElement): number {
  const copy = form.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("option").forEach((o) => o.remove());
  copy
    .querySelectorAll("details > :not(summary)")
    .forEach((folded) => folded.remove());
  return (copy.textContent ?? "").split(/\s+/).filter(Boolean).length;
}

/*
  yuvoy-operator#110. Three of the step's fields carried a full sentence each,
  the same for an operator's fourth listing as for their first, and nothing
  told a required field from an encouraged one.
*/
describe("Basics reads as labels and boxes", () => {
  it("marks the three the save refuses without, and only those", () => {
    basics();
    for (const name of ["Name", "Category", "Where it runs"]) {
      const field = screen.getByLabelText(name, { exact: true });
      expect(field).toBeRequired();
      expect(field.closest("div")).toHaveTextContent(/Required/);
    }
    for (const name of [
      "Activity",
      "One line about it",
      "What happens on the day",
    ]) {
      const field = screen.getByLabelText(name, { exact: true });
      expect(field).not.toBeRequired();
      expect(field.closest("div")).not.toHaveTextContent(/Required/);
    }
  });

  it("keeps one short example, read with the field it is for", () => {
    basics();
    expect(
      screen.getByLabelText("Name", { exact: true }),
    ).toHaveAccessibleDescription("For example, “Try-dive at Nemo Reef”.");
  });

  it("folds every reason away, still one tap from the field", () => {
    basics();
    const reasons = [
      /first thing a traveller reads/,
      /decides which documents we need/,
      /30 characters or more/,
    ];
    for (const reason of reasons) {
      const text = screen.getByText(reason);
      expect(text).not.toBeVisible();
      // Inside a disclosure, not deleted: nothing that was said is lost.
      expect(text.closest("details")).not.toBeNull();
    }
    expect(screen.getAllByText("Why?")).toHaveLength(2);
    expect(screen.getByText("How much to write?")).toBeVisible();
    // And never read out as the field's description: a reason is opt-in.
    expect(
      screen.getByLabelText("Activity", { exact: true }),
    ).not.toHaveAccessibleDescription();
  });

  it("stays within the forty words a sheet may hold", () => {
    const { container } = basics();
    const form = container.querySelector("form")!;
    expect(visibleWords(form)).toBeLessThanOrEqual(40);
  });
});

/*
  `Required` means "the step will not save without it" on every step, so its
  absence means the same thing everywhere: it can wait. A marker that
  disagreed with the control would be worse than none.
*/
describe("the Required marker, on every step", () => {
  const steps = {
    basics,
    selling: () =>
      render(
        <SellingStep
          id="exp_1"
          listing={{}}
          commissionRateBps={null}
          back="/account/listings/exp_1/edit?step=basics"
        />,
      ),
    location: () =>
      render(
        <LocationStep
          id="exp_1"
          listing={{}}
          vocabulary={null}
          back="/account/listings/exp_1/edit?step=schedule"
        />,
      ),
  };

  for (const [step, draw] of Object.entries(steps)) {
    it(`agrees with the controls on ${step}`, () => {
      const { container } = draw();
      const form = container.querySelector("form")!;
      for (const control of form.querySelectorAll<HTMLElement>(
        "input:not([type=hidden]):not([type=radio]), select, textarea",
      )) {
        const label = form.querySelector(`label[for="${control.id}"]`);
        expect(label, `a label for #${control.id}`).not.toBeNull();
        const marked = within(label!.parentElement!).queryByText("Required");
        expect(
          Boolean(marked),
          `#${control.id} is ${control.hasAttribute("required") ? "" : "not "}required`,
        ).toBe(control.hasAttribute("required"));
      }
    });
  }
});
