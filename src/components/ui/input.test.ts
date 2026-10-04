import { describe, expect, it } from "vitest";
import { fieldLabelClass, inputClass, textareaClass } from "./input";

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

/*
  O04 A (approved 4 Oct 2026): a field marked invalid used to grow its border
  from 1px to 2px, which moved its words by a pixel the moment the mark
  landed. The mark is the accent border and a 1px ring inside it now: the
  same two pixels, taking no room.
*/
describe("a field marked invalid", () => {
  it.each([
    ["an input", inputClass()],
    ["a textarea", textareaClass()],
  ])("is marked on %s without its border growing", (_, classes) => {
    const list = classes.split(" ");
    expect(list).toContain("aria-[invalid=true]:border-terra-deep");
    expect(list).toContain("aria-[invalid=true]:inset-ring");
    expect(list).toContain("aria-[invalid=true]:inset-ring-terra-deep");
    expect(list).not.toContain("aria-[invalid=true]:border-2");
  });

  it("answers focus in 150ms, and never animates the ring", () => {
    const list = inputClass().split(" ");
    expect(list).toContain("duration-150");
    expect(list).toContain("transition-[border-color,background-color]");
  });
});
