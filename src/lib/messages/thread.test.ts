import { describe, it, expect } from "vitest";
import {
  REMOVED_TEXT,
  closedLine,
  lastActivityLabel,
  newestMessageId,
  shortDay,
  textRemoved,
  tripLine,
  unreadLabel,
  type ThreadMessage,
} from "./thread";

const TZ = "Asia/Kolkata";

function message(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: "msg_1",
    from: "traveller",
    senderName: "Asha Menon",
    text: "Hello",
    sentAt: "2026-09-14T06:00:00+05:30",
    ...over,
  };
}

describe("a message whose text was removed", () => {
  it("is decided by the field, not by the text being empty", () => {
    /*
      "Every message carries exactly one of `text` and `textRemovedAt`." Reading
      emptiness instead would label a hypothetical blank message as removed,
      which tells an operator that something was said and then taken away.
    */
    expect(textRemoved(message())).toBe(false);
    expect(
      textRemoved(
        message({ text: undefined, textRemovedAt: "2026-09-14T03:00:00Z" }),
      ),
    ).toBe(true);
  });

  it("is never an empty bubble", () => {
    // The contract's own instruction: "show it as a message whose text was
    // removed, never as an empty one."
    expect(REMOVED_TEXT).toBe("Message removed");
  });
});

describe("why the composer is not there", () => {
  it("names the reason, and says the conversation can still be read", () => {
    /*
      All three say it, because that is the part a missing box does NOT say. An
      operator opening a cancelled booking looking for what was agreed should
      find it, rather than conclude the history went with the booking.
    */
    for (const reason of ["cancelled", "declined", "window_closed"]) {
      expect(closedLine(reason)).toContain("can still be read");
    }
    expect(closedLine("cancelled")).toContain("was cancelled");
    expect(closedLine("declined")).toContain("was declined");
    expect(closedLine("window_closed")).toContain("are closed");
  });

  it("does not guess at a reason it has never heard of", () => {
    /*
      `closedReason` is "present only when `canWrite` is `false`", so an absent
      one here is a response disagreeing with itself or a reason added after this
      build. Naming the wrong one tells somebody their booking was cancelled when
      it was not.
    */
    const line = closedLine(undefined);
    expect(line).toContain("can still be read");
    expect(line).not.toContain("cancelled");
    expect(line).not.toContain("declined");
  });
});

describe("what to mark read", () => {
  it("is the newest message on screen, by position", () => {
    /*
      "Send the id of a message actually drawn, never a later one." The marker
      moves to this message and to everything before it, so a later id would mark
      read something nobody was shown.

      By POSITION rather than by the latest `sentAt`: the order is the API's, and
      two messages can carry the same timestamp.
    */
    const drawn = [
      message({ id: "a", sentAt: "2026-09-14T06:00:00+05:30" }),
      message({ id: "b", sentAt: "2026-09-14T06:00:00+05:30" }),
      message({ id: "c", sentAt: "2026-09-14T05:00:00+05:30" }),
    ];
    expect(newestMessageId(drawn)).toBe("c");
  });

  it("is nothing at all in an empty conversation", () => {
    // Nobody has written, so there is no message to name and the read call must
    // not be made with an invented id: that answers 404.
    expect(newestMessageId([])).toBeNull();
  });
});

describe("the unread strip's number", () => {
  it("does not say 1 messages", () => {
    expect(unreadLabel(1)).toBe("1 unread message");
    expect(unreadLabel(2)).toBe("2 unread messages");
    expect(unreadLabel(17)).toBe("17 unread messages");
  });
});

describe("when a conversation was last written in", () => {
  const now = Date.parse("2026-09-16T10:00:00+05:30");

  it("counts minutes up close", () => {
    expect(lastActivityLabel("2026-09-16T09:48:00+05:30", now, TZ)).toBe(
      "12 min ago",
    );
  });

  it("counts hours for the rest of the same day", () => {
    expect(lastActivityLabel("2026-09-16T07:00:00+05:30", now, TZ)).toBe(
      "3 hours ago",
    );
    expect(lastActivityLabel("2026-09-16T09:00:00+05:30", now, TZ)).toBe(
      "1 hour ago",
    );
  });

  it("switches to a day once 'how long ago' stops meaning anything", () => {
    /*
      The switch is at a DAY, not at some number of hours. Inside today, how
      long ago is what somebody is judging; past that the useful fact is which
      day, and "31 hours ago" makes an operator do arithmetic at six in the
      morning.
    */
    expect(lastActivityLabel("2026-09-15T23:00:00+05:30", now, TZ)).toBe(
      "Tue 15 Sep",
    );
  });

  it("does not print a negative number when the clocks disagree", () => {
    // A message from the near future is a clock disagreement, not one that has
    // not been written yet.
    expect(lastActivityLabel("2026-09-16T10:05:00+05:30", now, TZ)).toBe(
      "just now",
    );
  });

  it("is nothing for an absent or unparseable time, rather than 'Invalid Date'", () => {
    expect(lastActivityLabel(undefined, now, TZ)).toBeNull();
    expect(lastActivityLabel("not a date", now, TZ)).toBeNull();
  });

  it("reads the day in the MARKET's zone, not the device's", () => {
    /*
      A message written at 00:30 in Havelock is yesterday evening in UTC. The
      operator standing beside the boat is in Havelock, so the row has to agree
      with the clock on the wall beside them.
    */
    const atNight = Date.parse("2026-09-16T01:00:00+05:30");
    expect(lastActivityLabel("2026-09-16T00:30:00+05:30", atNight, TZ)).toBe(
      "30 min ago",
    );
  });
});

describe("the short date", () => {
  it("trims September to three letters like every other month", () => {
    /*
      Every English locale renders September as "Sept", which is the odd
      four-letter one in a column of three-letter months. Built from
      `formatToParts` so the month can be sliced and the separator stays ours.
    */
    expect(shortDay("2026-09-16T04:30:00Z", TZ)).toBe("Wed 16 Sep");
    expect(shortDay("2026-12-01T04:30:00Z", TZ)).toBe("Tue 1 Dec");
    expect(shortDay("2026-03-09T04:30:00Z", TZ)).toBe("Mon 9 Mar");
  });

  it("puts the departure day and time on a thread row", () => {
    expect(tripLine("2026-09-16T01:00:00Z", TZ)).toBe("Wed 16 Sep, 06:30");
    expect(tripLine(undefined, TZ)).toBeNull();
  });
});
