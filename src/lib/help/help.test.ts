import { describe, expect, it } from "vitest";
import { HELP, HELP_AREAS, helpHref } from "./index";

/*
  The help page is where the explanations cut from every screen went
  (yuvoy-operator#80 t4), so a broken entry is an answer nobody can reach.
*/
describe("the help registry", () => {
  it("gives every answer its own anchor", () => {
    const ids = HELP.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });

  it("files every answer under an area the page draws", () => {
    for (const t of HELP) expect(HELP_AREAS).toContain(t.area);
  });

  it("has a question and at least one paragraph in every entry", () => {
    for (const t of HELP) {
      expect(t.question.trim()).not.toBe("");
      expect(t.answer.length).toBeGreaterThan(0);
      for (const p of t.answer) expect(p.trim()).not.toBe("");
    }
  });

  it("links to one answer by its anchor", () => {
    expect(helpHref("not-on-sale")).toBe("/account/help#not-on-sale");
  });
});
