import { describe, it, expect } from "vitest";
import {
  CALL_OFF_REASONS,
  NOTE_MAX,
  RELAY_INTENTS,
  validateRelay,
} from "./relay-types";

/**
 * The relay's one operator-written value.
 *
 * The operator never sees a phone number and never writes a message: they pick
 * a structured intent and supply exactly one fact, and that fact is the only
 * thing they author that reaches a phone.
 */
describe("a relay", () => {
  it("takes a 24-hour time for the two time intents, and nothing else", () => {
    for (const intent of ["time_change", "weather_watch"]) {
      expect(validateRelay(intent, "09:30", "")).toBeNull();
      expect(validateRelay(intent, "23:59", "")).toBeNull();
      // A boat schedule is 24-hour everywhere else on the dock too.
      expect(validateRelay(intent, "9:30am", "")?.field).toBe("detail");
      expect(validateRelay(intent, "24:00", "")?.field).toBe("detail");
      expect(validateRelay(intent, "", "")?.field).toBe("detail");
    }
  });

  it("refuses a link or a newline in a detail", () => {
    /*
      Not injection safety — the contract is explicit that values are
      parameterised throughout. It is that "a template variable holding a URL
      or a newline renders as something nobody approved, and the messaging
      provider is entitled to reject the whole message for it". A message the
      provider rejects is a departure nobody was told about.
    */
    expect(
      validateRelay("meeting_point_change", "See https://x.example", "")?.field,
    ).toBe("detail");
    expect(
      validateRelay("meeting_point_change", "Beach 3\nhut", "")?.field,
    ).toBe("detail");
    // Ordinary punctuation and non-Latin script must still pass.
    expect(
      validateRelay("meeting_point_change", "Beach 3 dive hut", ""),
    ).toBeNull();
    expect(
      validateRelay("meeting_point_change", "Jetty 2 (north end)", ""),
    ).toBeNull();
    expect(validateRelay("bring_item", "தண்ணீர்", "")).toBeNull();
  });

  it("holds each intent to its own length bounds", () => {
    // meeting_point_change is 3–120; bring_item is 2–80.
    expect(validateRelay("meeting_point_change", "ab", "")?.field).toBe(
      "detail",
    );
    expect(validateRelay("meeting_point_change", "abc", "")).toBeNull();
    expect(validateRelay("bring_item", "a", "")?.field).toBe("detail");
    expect(validateRelay("bring_item", "ab", "")).toBeNull();
    expect(validateRelay("bring_item", "x".repeat(81), "")?.field).toBe(
      "detail",
    );
  });

  it("requires a note for the note intent, and no detail", () => {
    // `note` is the one intent that carries no detail — and the one whose text
    // never reaches a phone.
    expect(validateRelay("note", "", "")?.field).toBe("note");
    expect(
      validateRelay("note", "", "The boat is on the far jetty."),
    ).toBeNull();
  });

  it("caps a note at 500, whichever intent carries it", () => {
    const long = "x".repeat(NOTE_MAX + 1);
    expect(validateRelay("note", "", long)?.field).toBe("note");
    expect(validateRelay("time_change", "09:30", long)?.field).toBe("note");
    expect(
      validateRelay("time_change", "09:30", "x".repeat(NOTE_MAX)),
    ).toBeNull();
  });

  it("offers exactly the intents and reasons the contract defines", () => {
    // A code the API does not know is a message nobody receives.
    expect(RELAY_INTENTS.map((i) => i.intent)).toEqual([
      "time_change",
      "weather_watch",
      "meeting_point_change",
      "bring_item",
      "note",
    ]);
    expect(CALL_OFF_REASONS.map((r) => r.code)).toEqual([
      "weather",
      "equipment",
      "staffing",
      "safety",
      "insufficient_numbers",
    ]);
  });
});
