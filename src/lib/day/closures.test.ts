import { describe, it, expect } from "vitest";
import {
  closureLine,
  closureReason,
  closuresTouching,
  covers,
  departureClosures,
  inForce,
  listingClosures,
  wholeDayClosures,
  type Closure,
} from "./closures";

function closure(over: Partial<Closure> = {}): Closure {
  return {
    id: "blk_1",
    from: "2026-09-14",
    to: "2026-09-16",
    reasonCode: "WEATHER",
    departureIds: [],
    ...over,
  };
}

describe("a closure still in force", () => {
  it("is one nobody has reopened", () => {
    /*
      "Every closure touching the range, reopened ones included; those carry
      `reopenedAt`." Reading the list without this would show a day as closed
      for the rest of the season after somebody reopened it.
    */
    expect(inForce(closure())).toBe(true);
    expect(inForce(closure({ reopenedAt: "2026-09-15T04:00:00Z" }))).toBe(
      false,
    );
  });

  it("covers both ends of its range", () => {
    const c = closure();
    expect(covers(c, "2026-09-14")).toBe(true);
    expect(covers(c, "2026-09-16")).toBe(true);
    expect(covers(c, "2026-09-13")).toBe(false);
    expect(covers(c, "2026-09-17")).toBe(false);
  });
});

describe("what puts Closed on a day row", () => {
  const day = "2026-09-15";

  it("is a closure covering it that names neither a listing nor a departure", () => {
    expect(wholeDayClosures([closure()], day)).toHaveLength(1);
  });

  it("is NOT a closure of one listing, whose other boats still sail", () => {
    /*
      The exclusion that keeps the badge honest. "Closed" on the day row when
      only the dive listing is shut tells an operator their whole day is off,
      and the kayaks leave with nobody on them.
    */
    expect(
      wholeDayClosures([closure({ experienceId: "exp_dive" })], day),
    ).toHaveLength(0);
    expect(
      listingClosures([closure({ experienceId: "exp_dive" })], day),
    ).toHaveLength(1);
  });

  it("is NOT a closure of one departure", () => {
    expect(
      wholeDayClosures([closure({ departureId: "slot_dawn" })], day),
    ).toHaveLength(0);
  });

  it("is NOT a reopened one, however wide it was", () => {
    expect(
      wholeDayClosures([closure({ reopenedAt: "2026-09-15T04:00:00Z" })], day),
    ).toHaveLength(0);
  });

  it("does not need a departure on the day at all", () => {
    /*
      The whole reason this is read rather than inferred. The old rule was
      "every departure still running is closed", which an empty day can never
      satisfy: a shop that closed a fortnight in January saw fourteen ordinary
      empty days and no sign that anything had been done.
    */
    expect(wholeDayClosures([closure()], day)).toHaveLength(1);
  });
});

describe("a closure on one departure", () => {
  it("is found by that departure's id, and only in force", () => {
    const live = closure({ id: "blk_dep", departureId: "slot_dawn" });
    const undone = closure({
      id: "blk_old",
      departureId: "slot_dawn",
      reopenedAt: "2026-09-15T04:00:00Z",
    });
    expect(departureClosures([live, undone], "slot_dawn")).toEqual([live]);
  });

  it("is never matched by an empty id", () => {
    // A departure with no id would otherwise collect every closure that has no
    // `departureId` either, and the row would offer to reopen the whole day.
    expect(departureClosures([closure()], "")).toHaveLength(0);
  });
});

describe("what a day offers to reopen", () => {
  it("is widest first: the day, then a listing, then a departure", () => {
    /*
      Reopening the narrowest while the widest still holds changes nothing an
      operator can see, and a list in the other order invites exactly that. The
      API says so in its own answer: `departuresStillClosed` is "departures
      still to come that stay closed, because another closure in force also
      holds them".
    */
    const all = [
      closure({ id: "dep", departureId: "slot_dawn" }),
      closure({ id: "listing", experienceId: "exp_dive" }),
      closure({ id: "day" }),
    ];
    expect(
      closuresTouching(all, "2026-09-15", ["slot_dawn"]).map((c) => c.id),
    ).toEqual(["day", "listing", "dep"]);
  });

  it("leaves out a departure closure for a departure that is not on this day", () => {
    const all = [closure({ id: "dep", departureId: "slot_elsewhere" })];
    expect(closuresTouching(all, "2026-09-15", ["slot_dawn"])).toHaveLength(0);
  });
});

describe("why it was closed, in the operator's words", () => {
  it("labels the six a person gives", () => {
    expect(closureReason("WEATHER")).toBe("Weather");
    expect(closureReason("SEASONAL")).toBe("Out of season");
  });

  it("labels the one only a schedule save gives", () => {
    /*
      `SCHEDULE_CHANGED` is "given only by `PUT /experiences/{id}/schedule`" and
      never by anybody pressing a button. It still needs a label: a day closed
      by a schedule save with no reason beside it reads as a closure nobody can
      account for.
    */
    expect(closureReason("SCHEDULE_CHANGED")).toBe(
      "Removed from the weekly schedule",
    );
  });

  it("prints a code it has never heard of rather than dropping it", () => {
    // Dropping it says a day was closed for no reason; guessing says it was
    // closed for the wrong one, and an operator plans a week around that.
    expect(closureReason("VOLCANO")).toBe("VOLCANO");
  });

  it("puts the note after the reason when there is one", () => {
    expect(closureLine(closure({ note: "Back on the 17th." }))).toBe(
      "Weather. Back on the 17th.",
    );
    expect(closureLine(closure())).toBe("Weather");
  });
});
