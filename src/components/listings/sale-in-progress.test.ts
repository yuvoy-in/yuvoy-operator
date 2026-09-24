import { describe, expect, it } from "vitest";
import { saleInProgressMessage } from "./sale-in-progress";

/*
  Pausing a listing while somebody holds unpaid seats on it, or a request on it
  waits for an answer (`409 sale_in_progress`). A checkout hold lasts ten
  minutes and an accepted request up to twelve hours, so the refusal names
  when it ends: "try again in a few minutes" was false for the long one.
*/
const NOW = Date.parse("2026-09-22T06:00:00Z"); // 11:30 in the market

describe("why a listing cannot be paused yet", () => {
  it("names when the hold ends, in the market's clock", () => {
    expect(
      saleInProgressMessage(
        { heldUntil: "2026-09-22T09:11:00Z" },
        "somebody holds unpaid seats on this listing until 14:41",
        NOW,
      ),
    ).toBe(
      "Somebody holds unpaid seats on this listing until 14:41. You can pause it after that. Nothing changed.",
    );
  });

  it("says the day when the hold ends on another one", () => {
    expect(
      saleInProgressMessage({ heldUntil: "2026-09-23T02:30:00Z" }, "", NOW),
    ).toContain("until 08:00 on Wed 23 Sep");
  });

  it("names the requests to answer first, alone or beside a hold", () => {
    expect(saleInProgressMessage({ openRequests: 2 }, "", NOW)).toBe(
      "2 requests on this listing are waiting for your answer. Accept or decline them first. Nothing changed.",
    );
    expect(saleInProgressMessage({ openRequests: 1 }, "", NOW)).toBe(
      "1 request on this listing is waiting for your answer. Accept or decline it first. Nothing changed.",
    );
    expect(
      saleInProgressMessage(
        { heldUntil: "2026-09-22T09:11:00Z", openRequests: 1 },
        "",
        NOW,
      ),
    ).toBe(
      "Somebody holds unpaid seats on this listing until 14:41, and 1 request on it is waiting for your answer. Answer them, then pause it after 14:41. Nothing changed.",
    );
  });

  it("says the API's own sentence when the details are absent", () => {
    expect(
      saleInProgressMessage(
        undefined,
        "somebody is paying for this listing until 14:41",
        NOW,
      ),
    ).toBe("Somebody is paying for this listing until 14:41.");
  });

  it("falls back to a wait when there is nothing to name", () => {
    expect(saleInProgressMessage({ heldUntil: "not a time" }, "", NOW)).toBe(
      "Somebody is paying for this listing right now. Try again in a few minutes. Nothing changed.",
    );
  });
});
