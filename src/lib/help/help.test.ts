import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { HELP, HELP_AREAS, helpHref } from "./index";

/** Every `.ts`/`.tsx` under `src/` that is not itself a test. */
function sources(dir = "src", acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) sources(path, acc);
    else if (/\.tsx?$/.test(path) && !/\.test\.tsx?$/.test(path)) {
      acc.push(path);
    }
  }
  return acc;
}

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

  /*
    `helpHref` builds a URL out of whatever it is handed, so a screen can link
    to an anchor nobody wrote and land the reader at the top of the help page
    with no answer in sight. Nothing said so until a topic was deleted and
    every test still passed, which is the defect this guards.
  */
  it("links only to answers that exist", () => {
    const ids = new Set(HELP.map((t) => t.id));
    const broken: string[] = [];
    for (const file of sources()) {
      const src = readFileSync(file, "utf8");
      for (const [, id] of src.matchAll(/helpHref\(\s*"([^"]+)"\s*\)/g)) {
        if (!ids.has(id)) broken.push(`${file} links to #${id}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
