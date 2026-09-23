import { describe, expect, it } from "vitest";
import { helpSections } from "./sections";
import type { HelpTopic } from "./types";

const topic = (id: string, area: HelpTopic["area"]): HelpTopic => ({
  id,
  area,
  question: `About ${id}?`,
  answer: ["An answer."],
});

describe("the help page's sections", () => {
  it("follows the area order, not the order the registry lists them in", () => {
    const sections = helpSections([
      topic("team-one", "Team"),
      topic("money-one", "Money"),
      topic("home-one", "Home"),
    ]);
    expect(sections.map((s) => s.area)).toEqual(["Home", "Money", "Team"]);
  });

  it("leaves out an area with nothing in it", () => {
    /*
      The registry fills up in three files on three branches, so an empty area
      is the normal case on any one of them, and a heading over nothing reads
      as a page that failed to load.
    */
    const sections = helpSections([topic("money-one", "Money")]);
    expect(sections).toHaveLength(1);
    expect(sections[0].area).toBe("Money");
  });

  it("keeps each area's answers in the order they were written", () => {
    const sections = helpSections([
      topic("second", "Money"),
      topic("elsewhere", "Team"),
      topic("third", "Money"),
    ]);
    expect(sections[0].topics.map((t) => t.id)).toEqual(["second", "third"]);
  });

  it("draws nothing at all from an empty registry", () => {
    expect(helpSections([])).toEqual([]);
  });
});
