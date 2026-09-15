import { describe, it, expect } from "vitest";
import {
  NOT_ANSWERED,
  answerFor,
  canCancelBooking,
  canReturnCash,
  dayAndMonth,
  endingLine,
  needsReview,
  toQuestions,
} from "./ending";

const TZ = "Asia/Kolkata";
const AT = "2026-09-12T10:30:00+05:30";

describe("why a booking ended", () => {
  it("says nothing at all about a booking that did not end", () => {
    // `cancellation` is "present only on a booking that was cancelled or
    // declined". No object, no line.
    expect(endingLine(undefined, TZ)).toBeNull();
  });

  it("names the call-off reason when the departure was called off", () => {
    expect(
      endingLine(
        { at: AT, by: "operator", calledOff: { reasonCode: "weather" } },
        TZ,
      ),
    ).toBe("Called off by your team on 12 Sep: Weather");
  });

  it("names our own reason when we cancelled this one booking", () => {
    expect(
      endingLine(
        {
          at: AT,
          by: "operator",
          operatorCancelled: { reasonCode: "insufficient_numbers" },
        },
        TZ,
      ),
    ).toBe("Cancelled by your team on 12 Sep: Not enough people");
  });

  it("says the traveller asked, however that request reached us", () => {
    /*
      Two codes, one meaning: "`by` says whether they did it themselves from
      their booking link or our team did it for them." The operator needs the
      same sentence either way, and a different who.
    */
    expect(
      endingLine(
        { at: AT, by: "traveller", reasonCode: "CUSTOMER_REQUEST" },
        TZ,
      ),
    ).toBe("Cancelled by the traveller on 12 Sep: the traveller asked");
    expect(
      endingLine({ at: AT, by: "yuvoy", reasonCode: "TRAVELLER_REQUEST" }, TZ),
    ).toBe("Cancelled by Yuvoy on 12 Sep: the traveller asked");
  });

  it("explains a cancellation that followed a move, and names the traveller", () => {
    /*
      The one case where the actor is part of the reason: they cancelled from
      their link "after you moved the departure, so they got back everything
      they paid online whatever the usual tiers say". An operator reading this
      without the cause would think a full refund was a mistake.
    */
    expect(
      endingLine(
        { at: AT, by: "traveller", reasonCode: "OPERATOR_MOVED_IT" },
        TZ,
      ),
    ).toBe(
      "Cancelled by the traveller on 12 Sep after the departure was moved",
    );
  });

  it("explains a payment we could not honour, without hanging the date off it", () => {
    /*
      `system` is the one actor whose label is a clause, and the issue's template
      puts it before the date. "Cancelled by Yuvoy, because the payment could not
      be honoured on 12 Sep" attaches the date to the payment rather than to the
      cancellation. Same words, and only this actor's order moves.
    */
    expect(
      endingLine({ at: AT, by: "system", reasonCode: "PAYMENT_FAILED" }, TZ),
    ).toBe(
      "Cancelled on 12 Sep by Yuvoy, because the payment could not be honoured",
    );
  });

  it("falls back to the plainest line for a code it has never heard of", () => {
    /*
      The contract's own escape: "if you meet a value you do not recognise, say
      the booking was cancelled, and by whom." A client that guessed would put
      a sentence about weather on a booking cancelled for something else.
    */
    expect(
      endingLine({ at: AT, by: "yuvoy", reasonCode: "SOMETHING_NEW" }, TZ),
    ).toBe("Cancelled by Yuvoy on 12 Sep");
  });

  it("leaves out who when nobody is recorded, rather than inventing one", () => {
    // "Absent only if no record says who." "By somebody" would read as a person
    // we are declining to name.
    expect(
      endingLine({ at: AT, calledOff: { reasonCode: "safety" } }, TZ),
    ).toBe("Called off on 12 Sep: Safety");
    expect(endingLine({ at: AT }, TZ)).toBe("Cancelled on 12 Sep");
  });

  it("prints a reason code it cannot label rather than dropping it", () => {
    // A sixth call-off reason added on the other side. Showing the raw code is
    // ugly; showing nothing tells an operator the departure was called off for
    // no reason.
    expect(
      endingLine({ at: AT, calledOff: { reasonCode: "volcano" } }, TZ),
    ).toBe("Called off on 12 Sep: volcano");
  });

  it("says nothing when there is no date to place it against", () => {
    // `at` is required by the contract. Without it, "cancelled by your team" is
    // a fact an operator cannot put anywhere.
    expect(endingLine({ by: "operator" }, TZ)).toBeNull();
  });

  it("reads the date in the DEPARTURE's zone", () => {
    // 00:30 in Havelock is the previous evening in UTC, and the operator
    // standing beside the boat is in Havelock.
    expect(dayAndMonth("2026-09-13T00:30:00+05:30", TZ)).toBe("13 Sep");
    expect(dayAndMonth("2026-09-13T00:30:00+05:30", "UTC")).toBe("12 Sep");
  });
});

describe("needs review", () => {
  it("is the server's flag and nothing computed", () => {
    /*
      The manifest fixture carries a party the API flagged with `clear: true`
      beside it, so the flag is NOT derivable from the answers. A client that
      derived one would clear somebody the server had held back.
    */
    expect(needsReview({ needsAttention: true })).toBe(true);
    expect(needsReview({ needsAttention: false })).toBe(false);
  });

  it("is false when the listing asks no medical question at all", () => {
    // `screening` is "present only when the listing asks a medical question",
    // and an absent object must not draw a chip on a snorkel trip.
    expect(needsReview(undefined)).toBe(false);
  });
});

describe("what the party answered", () => {
  it("never leaves a question blank", () => {
    expect(
      answerFor({
        questionId: "q1",
        text: "Any medical conditions?",
        answered: false,
        current: true,
      }),
    ).toBe(NOT_ANSWERED);
  });

  it("reads a deleted answer exactly as an unanswered one", () => {
    /*
      By design: "afterwards every question the listing still asks reads
      `answered: false` … exactly as a question never answered reads." Saying
      "deleted" where nobody ever answered would be a claim about a traveller.
    */
    expect(
      answerFor({
        questionId: "q1",
        text: "Any medical conditions?",
        answered: false,
        current: true,
      }),
    ).toBe(NOT_ANSWERED);
  });

  it("does not print an empty answer as an answer", () => {
    // `answered: true` with nothing in `answer` is a response disagreeing with
    // itself, and a blank under a question reads as something somebody said.
    expect(
      answerFor({
        questionId: "q1",
        text: "Any medical conditions?",
        answered: true,
        answer: "   ",
        current: true,
      }),
    ).toBe(NOT_ANSWERED);
  });

  it("keeps the order the listing sent, and drops a question with no words", () => {
    const parsed = toQuestions([
      { questionId: "q2", text: "Shoe size?", answered: true, answer: "44" },
      { questionId: "q1", text: "", answered: false },
      { questionId: "q3", text: "Swim?", answered: false, current: false },
    ]);
    expect(parsed.map((q) => q.text)).toEqual(["Shoe size?", "Swim?"]);
    // Absent `current` is `true`: "no longer asked" is a claim only the server
    // makes, and defaulting the other way marks every question withdrawn.
    expect(parsed[0].current).toBe(true);
    expect(parsed[1].current).toBe(false);
  });
});

describe("whether cancelling is even offered", () => {
  const now = Date.parse("2026-09-14T10:00:00+05:30");
  const later = "2026-09-14T16:00:00+05:30";
  const earlier = "2026-09-14T06:00:00+05:30";

  it("is offered on a booking that is still on, before it leaves", () => {
    expect(canCancelBooking("confirmed", later, now)).toBe(true);
    expect(canCancelBooking("paid_pending_ops", later, now)).toBe(true);
  });

  it("is withheld once the departure has left", () => {
    // The API answers `409 departure_started`, and the refusal is knowable from
    // what is already on screen.
    expect(canCancelBooking("confirmed", earlier, now)).toBe(false);
  });

  it("is withheld on a booking that already ended", () => {
    for (const state of ["cancelled", "declined", "completed", "no_show"]) {
      expect(canCancelBooking(state, later, now), state).toBe(false);
    }
  });

  it("is withheld when there is no departure time to judge", () => {
    // Offering it would be guessing that the trip has not left.
    expect(canCancelBooking("confirmed", undefined, now)).toBe(false);
    expect(canCancelBooking("confirmed", "not a date", now)).toBe(false);
  });
});

describe("whether the cash is still to hand back", () => {
  it("is offered on a cancelled booking whose cash was taken", () => {
    expect(canReturnCash("cancelled", { collected: true })).toBe(true);
  });

  it("goes once it is recorded, because it cannot be undone", () => {
    expect(
      canReturnCash("cancelled", {
        collected: true,
        returnedAt: "2026-09-14T10:00:00+05:30",
      }),
    ).toBe(false);
  });

  it("is never offered on a trip that is still on", () => {
    // "I gave the cash back" under the thumb of somebody running a departure is
    // one mis-tap from a record that says a traveller was refunded.
    expect(canReturnCash("confirmed", { collected: true })).toBe(false);
  });

  it("is not offered when no cash was ever taken", () => {
    expect(canReturnCash("cancelled", { collected: false })).toBe(false);
    expect(canReturnCash("cancelled", undefined)).toBe(false);
  });
});
