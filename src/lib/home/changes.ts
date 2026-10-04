import type { Need } from "./needs";

/**
 * What a re-read of Home changed in "Needs you", and how it is said (O01 A,
 * approved 4 Oct 2026, with the owner's words for the two sentences).
 *
 * Today re-reads itself on every focus, when the signal comes back and every
 * minute while it is open, so a request can arrive, or be answered on another
 * phone, while the operator's thumb is on the screen. Nothing moves when it
 * does (a list that slides under a thumb is how the wrong request gets
 * accepted); what changed is marked and said instead.
 *
 * Only what the operator did NOT do counts. A card they answered, opened or
 * took cash on is kept in its place by the list (`kept`), so its leaving the
 * server's answer is not news to them; everything else that leaves left
 * somewhere else.
 *
 * Pure, so the rules are proved without rendering anything.
 */
export function needChanges(
  before: readonly Need[],
  after: readonly Need[],
  kept: ReadonlySet<string>,
): { arrived: Need[]; gone: Need[] } {
  const was = new Set(before.map((need) => need.key));
  const now = new Set(after.map((need) => need.key));
  return {
    arrived: after.filter((need) => !was.has(need.key)),
    gone: before.filter((need) => !now.has(need.key) && !kept.has(need.key)),
  };
}

/**
 * The sentences a screen reader hears for those changes, once each, in a
 * polite live region. The owner's words (4 Oct 2026), with the live values:
 *
 *   "Seat request from Kavya Iyer, 18 min left."
 *   "Daniel Okafor's request is no longer waiting."
 *
 * Said for seat requests, the one change with a clock on it. A request that
 * carries no name is "the traveller", lower-cased where it falls mid-sentence.
 */
export function changeSentences(
  arrived: readonly Need[],
  gone: readonly Need[],
): string[] {
  const lines: string[] = [];
  for (const need of arrived) {
    if (need.kind !== "request") continue;
    lines.push(
      `Seat request from ${inSentence(need.view.name)}, ${need.view.clock}.`,
    );
  }
  for (const need of gone) {
    if (need.kind !== "request") continue;
    lines.push(`${need.view.name}'s request is no longer waiting.`);
  }
  return lines;
}

/** "The traveller" mid-sentence; a person's name as it is. */
function inSentence(name: string): string {
  return name === "The traveller" ? "the traveller" : name;
}
