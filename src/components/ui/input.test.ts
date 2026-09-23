import { describe, expect, it } from "vitest";
import { fieldLabelClass } from "./input";

/*
  The words that name a field, after yuvoy-operator#85 s11: "the field labels
  are shouted sentences: WHAT IS IT CALLED, WHAT KIND OF THING IT IS". They
  were set in the `label` utility, which is uppercase and wide-tracked.
*/

describe("a field's label", () => {
  it("is not the shouted editorial label", () => {
    const classes = fieldLabelClass().split(" ");
    expect(classes).not.toContain("label");
    expect(classes).not.toContain("uppercase");
  });

  it("carries the ink and the size a label is drawn in", () => {
    const classes = fieldLabelClass().split(" ");
    expect(classes).toContain("text-forest/75");
    expect(classes).toContain("text-sm");
  });

  it("lets a caller add to it, and override what it sets", () => {
    expect(fieldLabelClass("mr-2").split(" ")).toContain("mr-2");

    const darker = fieldLabelClass("text-forest").split(" ");
    expect(darker).toContain("text-forest");
    expect(darker).not.toContain("text-forest/75");
  });
});
