/**
 * The relay — how an operator talks to a traveller now that phone numbers are
 * gone (O12/D-018).
 *
 * Facts travel in approved templates; free text stays on the status page. The
 * operator picks a structured intent and supplies exactly one fact, which is
 * the only operator-written value that reaches a phone.
 */

export const RELAY_INTENTS = [
  {
    intent: "time_change",
    label: "The time has changed",
    /** A 24-hour time. */
    detail: "time" as const,
    detailLabel: "New time",
    placeholder: "09:30",
    help: "24-hour, like 09:30.",
  },
  {
    intent: "weather_watch",
    label: "Watching the weather",
    detail: "time" as const,
    detailLabel: "You will decide by",
    placeholder: "07:00",
    help: "24-hour. When you will tell them yes or no.",
  },
  {
    intent: "meeting_point_change",
    label: "The meeting point has changed",
    detail: "text" as const,
    detailLabel: "New meeting point",
    placeholder: "Beach 3 dive hut",
    help: "3 to 120 characters.",
    min: 3,
    max: 120,
  },
  {
    intent: "bring_item",
    label: "Bring something",
    detail: "text" as const,
    detailLabel: "What to bring",
    placeholder: "A towel and sunscreen",
    help: "2 to 80 characters.",
    min: 2,
    max: 80,
  },
  {
    intent: "note",
    label: "Leave a note (not sent to a phone)",
    detail: "none" as const,
    detailLabel: "",
    placeholder: "",
    help: "Shown on their booking page. It does NOT reach their phone.",
  },
] as const;

export type RelayIntent = (typeof RELAY_INTENTS)[number]["intent"];

export const NOTE_MAX = 500;

export function relayIntent(intent: string) {
  return RELAY_INTENTS.find((i) => i.intent === intent);
}

/** A 24-hour clock time, which is what the two time intents accept. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Letters, numbers and basic punctuation.
 *
 * Not for injection safety — the contract is explicit that values are
 * parameterised throughout. It is because "a template variable holding a URL
 * or a newline renders as something nobody approved, and the messaging
 * provider is entitled to reject the whole message for it." A message rejected
 * by the provider is a departure nobody was told about.
 *
 * `:` and `/` are deliberately NOT in the set, and that is the whole point:
 * they are the two characters a URL cannot form without. A first draft of this
 * allowed both as "basic punctuation" and happily accepted
 * `See https://x.example`, which is exactly the value the rule exists to stop.
 * A meeting point does not need either — "Jetty 2 (north end)" is fine.
 *
 * `\p{M}` is in the set because `\p{L}` alone is not enough for the scripts
 * this market actually writes in. Tamil, Hindi and Bengali build characters
 * from a letter plus combining marks — `ண்` is ண plus a virama — so a
 * letters-and-numbers rule without `\p{M}` rejects the whole word. An
 * operator in the Andamans naming a meeting point in Tamil is not an edge
 * case.
 */
const PLAIN = /^[\p{L}\p{M}\p{N} .,'’&()+-]+$/u;

export interface RelayProblem {
  field: "detail" | "note";
  message: string;
}

/**
 * Validates a relay before it is sent, with the same rules the API applies.
 *
 * Checked here as well as server-side because the alternative is an operator
 * on a jetty reading a 400 they cannot act on. The API remains the authority;
 * this just refuses the obviously-wrong before it costs a round trip.
 */
export function validateRelay(
  intent: string,
  detail: string,
  note: string,
): RelayProblem | null {
  const spec = relayIntent(intent);
  if (!spec) {
    return { field: "detail", message: "Pick what you are telling them." };
  }

  /*
    The note cap is checked FIRST, for every intent, because a note may
    accompany any of them. An earlier version checked it only on the branches
    that fell through to the bottom, so a 600-character note attached to a
    time change passed validation here and was rejected by the API — which is
    the round trip this function exists to save.
  */
  if (note.trim().length > NOTE_MAX) {
    return {
      field: "note",
      message: `Notes are capped at ${NOTE_MAX} characters.`,
    };
  }

  if (spec.detail === "none") {
    if (!note.trim())
      return { field: "note", message: "Write the note first." };
    return null;
  }

  const value = detail.trim();
  if (!value) {
    return { field: "detail", message: `${spec.detailLabel} is required.` };
  }

  if (spec.detail === "time") {
    if (!TIME.test(value)) {
      return { field: "detail", message: "Use a 24-hour time, like 09:30." };
    }
    return null;
  }

  const min = "min" in spec ? spec.min : 1;
  const max = "max" in spec ? spec.max : 120;
  if (value.length < min || value.length > max) {
    return {
      field: "detail",
      message: `${spec.detailLabel} must be ${min} to ${max} characters.`,
    };
  }
  if (!PLAIN.test(value)) {
    return {
      field: "detail",
      message:
        "Letters, numbers and basic punctuation only: no links or line breaks.",
    };
  }

  return null;
}

/** Why a departure cannot run. A closed set, in the contract's order. */
export const CALL_OFF_REASONS = [
  { code: "weather", label: "Weather" },
  { code: "equipment", label: "Equipment" },
  { code: "staffing", label: "Staffing" },
  { code: "safety", label: "Safety" },
  { code: "insufficient_numbers", label: "Not enough people" },
] as const;

export type CallOffReason = (typeof CALL_OFF_REASONS)[number]["code"];

/* ------------------------------------------------------------ receipts -- */

/**
 * How a channel is said in a sentence. Only the channels the contract's
 * `RequestAnswer.toldBy` names, plus nothing: an unknown channel is left out
 * of the sentence rather than guessed at.
 */
const CHANNEL_WORDS: Record<string, string> = {
  whatsapp: "on WhatsApp",
  email: "by email",
};

/** What a relay came back with, as the receipt reads it. */
export interface RelayOutcome {
  intent?: string;
  /** People a message is actually going to. Never bookings (yuvoy-api#200). */
  recipients: number;
  /** The same number by channel, e.g. `{ email: 3 }`. */
  byChannel?: Record<string, number>;
}

/**
 * The receipt's headline: who was told, and how (yuvoy-operator#89).
 *
 * `recipients` counts queued messages since 20 September, "never bookings: a
 * person we hold no reachable address for is not somebody who was told, and
 * until 20 September this number said they were". So it is the number to say,
 * and the channel says what an operator would otherwise have to assume: with
 * no WhatsApp sender today, "told" means "emailed".
 *
 * A note's words never reach a phone, and its count is people messaged about
 * it rather than bookings it was left on, so a note's headline carries no
 * number rather than the wrong one.
 */
export function relayHeadline(
  outcome: RelayOutcome,
  scope: "booking" | "departure",
): string {
  if (outcome.intent === "note") {
    return scope === "booking"
      ? "Note left on their booking page"
      : "Note left on their booking pages";
  }
  const n = outcome.recipients;
  if (n <= 0) return "Nobody was told";
  return `Told ${n} ${n === 1 ? "person" : "people"}${channelPhrase(outcome)}`;
}

/**
 * " by email", or ": 2 on WhatsApp, 1 by email", or "" when the split is
 * absent, unknown, or does not add up to the headline's number: a sentence
 * whose parts disagree with its total is worse than no split at all.
 */
function channelPhrase(outcome: RelayOutcome): string {
  const entries = Object.entries(outcome.byChannel ?? {}).filter(
    ([channel, count]) =>
      CHANNEL_WORDS[channel] !== undefined &&
      Number.isInteger(count) &&
      count > 0,
  );
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  if (entries.length === 0 || total !== outcome.recipients) return "";
  if (entries.length === 1) return ` ${CHANNEL_WORDS[entries[0][0]]}`;
  return `: ${entries
    .map(([channel, count]) => `${count} ${CHANNEL_WORDS[channel]}`)
    .join(", ")}`;
}

/**
 * The sentence for people nothing could reach, or null when there are none.
 *
 * The API's own `notReachedNote` is preferred, "safe to show the operator
 * verbatim". Ours is the fallback for a response that carries the count and
 * not the sentence. Either way the operator learns the one thing that changes
 * what they do: those people have not heard, and only the operator can tell
 * them some other way.
 */
export function notReachedSentence(
  notReached: number | undefined,
  apiNote: string | undefined,
): string | null {
  if (!notReached || notReached <= 0) return null;
  if (apiNote && apiNote.trim()) return apiNote.trim();
  return notReached === 1
    ? "1 person could not be sent this: we hold no way to reach them. Their booking page shows it."
    : `${notReached} people could not be sent this: we hold no way to reach them. Their booking pages show it.`;
}
