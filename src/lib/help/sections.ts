import { HELP_AREAS, type HelpArea, type HelpTopic } from "./types";

/**
 * The help page's order: the areas in `HELP_AREAS` order, each with its
 * answers in the order its registry file lists them.
 *
 * An area with no answers is left out rather than drawn as a heading over
 * nothing. The registry is split into three files that fill up separately
 * (home, operating, account), so on any given day some areas are empty, and a
 * page of headings with nothing under them reads as a page that failed to load.
 */
export interface HelpSection {
  area: HelpArea;
  topics: readonly HelpTopic[];
}

export function helpSections(topics: readonly HelpTopic[]): HelpSection[] {
  return HELP_AREAS.map((area) => ({
    area,
    topics: topics.filter((topic) => topic.area === area),
  })).filter((section) => section.topics.length > 0);
}
