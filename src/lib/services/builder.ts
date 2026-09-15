/**
 * The seven steps of the listing builder — yuvoy-operator#58 item 7.
 *
 * ## One draft, saved step by step
 *
 * There is no wizard state anywhere but the draft itself. Next saves the step
 * and moves on; Back saves nothing; closing the tab loses nothing that was
 * saved, and nothing that was not. The step an operator returns to is derived
 * from `publishBlockers` rather than remembered, because the draft is the only
 * thing that survives a phone going flat on a jetty.
 *
 * ## Why the order is this order
 *
 * It is the order the listing becomes real in: what it is, what it costs, when
 * it runs, where it meets, what it needs to know, what it looks like, and then
 * the whole thing read back before it goes to a person at Yuvoy.
 */

export const STEPS = [
  "basics",
  "selling",
  "schedule",
  "location",
  "questions",
  "media",
  "review",
] as const;

export type Step = (typeof STEPS)[number];

export const STEP_LABEL: Record<Step, string> = {
  basics: "Basics",
  selling: "Selling",
  schedule: "Schedule",
  location: "Location and safety",
  questions: "Questions",
  media: "Media",
  review: "Review",
};

/** `?step=` from the URL, or the first step when it says nothing usable. */
export function readStep(value: string | undefined): Step {
  return (STEPS as readonly string[]).includes(value ?? "")
    ? (value as Step)
    : "basics";
}

export function nextStep(step: Step): Step | null {
  const i = STEPS.indexOf(step);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null;
}

export function previousStep(step: Step): Step | null {
  const i = STEPS.indexOf(step);
  return i > 0 ? STEPS[i - 1] : null;
}

/**
 * Which step owns a publish blocker.
 *
 * The map is the issue's, field for field. A blocker this build has not heard
 * of belongs to no step: marking a step unfinished over a field it does not
 * contain sends an operator round a form looking for a control that is not
 * there.
 */
const OWNER: Record<string, Step> = {
  title: "basics",
  category: "basics",
  summary: "basics",
  description: "basics",
  activityType: "basics",
  destination: "basics",
  unitPricePaise: "selling",
  pricingUnit: "selling",
  durationMinutes: "selling",
  maxPartySize: "selling",
  meetingPoint: "location",
};

export function stepOwning(blocker: string): Step | null {
  return OWNER[blocker] ?? null;
}

/** Every step still holding something the listing cannot be published without. */
export function unfinishedSteps(blockers: readonly string[]): Set<Step> {
  const out = new Set<Step>();
  for (const blocker of blockers) {
    const step = stepOwning(blocker);
    if (step) out.add(step);
  }
  return out;
}

/**
 * Where reopening a draft lands.
 *
 * "The first step holding a field in `publishBlockers`", in step order rather
 * than in the order the API listed them: an operator reopening a half-built
 * listing should meet the earliest gap, not whichever the server happened to
 * name first. With none, Review, because there is nothing left to fill in.
 */
export function openingStep(blockers: readonly string[]): Step {
  const unfinished = unfinishedSteps(blockers);
  return STEPS.find((step) => unfinished.has(step)) ?? "review";
}
