/**
 * The message threads, moved out of
 * fixtures.ts (yuvoy-operator#178), which re-exports them by name.
 */
import { todayAt } from "./fixtures-base";

/* --------------------------------------------------- conversations ------- */

export interface MockMessage {
  id: string;
  from: "traveller" | "operator";
  senderName: string;
  text?: string;
  textRemovedAt?: string;
  sentAt: string;
}

export interface MockThread {
  bookingId: string;
  messages: MockMessage[];
  /** Absent means writable. Set means the composer is gone, and why. */
  closedReason?: "cancelled" | "declined" | "window_closed";
  /** How many of the traveller's messages nobody has marked read yet. */
  unread: number;
}

/**
 * Four conversations, and each one exists for a branch that is otherwise
 * unreachable — yuvoy-operator#52.
 *
 * `bkg_1` is the live one, and it carries **two unread** so the Home strip has a
 * number to draw and a number to lose. It is long enough to page: the endpoint's
 * first page is the most recent messages and `nextCursor` walks backwards, which
 * is the opposite of how a list usually reads, and a conversation that fits on
 * one page would let a client ship that backwards.
 *
 * `bkg_2` is CANCELLED: messages, the cancelled line, and no composer. `bkg_3`
 * is `window_closed`, which is the same shape with a different sentence and the
 * one an operator meets most often, since every trip reaches it eventually.
 *
 * `bkg_5` holds a message whose text was REMOVED. "The message stays, with who
 * wrote it and when" — an empty bubble would say somebody sent nothing, which is
 * a different and untrue thing.
 */
/**
 * The part of a long conversation nobody reads, so the part that CAN be paged.
 *
 * Alternating sides, oldest first, ending three days before the hand-written
 * messages begin. The first one is distinctive on purpose: it is what a test
 * looks for to prove "Show earlier messages" reached the beginning.
 */
function earlierChat(count: number): MockMessage[] {
  return Array.from({ length: count }, (_, i) => {
    const traveller = i % 2 === 0;
    return {
      id: `msg_1_early_${String(i).padStart(2, "0")}`,
      from: traveller ? ("traveller" as const) : ("operator" as const),
      senderName: traveller ? "Asha Menon" : "Priya Raut",
      text:
        i === 0
          ? "This is where the conversation begins."
          : traveller
            ? `Another question, number ${i}.`
            : `Answered, number ${i}.`,
      /*
        Spread across the days before the written ones, so the list is ordered by
        something real rather than by array position alone. Ten minutes apart is
        enough to keep every `sentAt` distinct without running into the next day.
      */
      sentAt: todayAt(
        `${String(8 + Math.floor(i / 6)).padStart(2, "0")}:${String((i % 6) * 10).padStart(2, "0")}`,
        -10 + Math.floor(i / 6),
      ),
    };
  });
}

export const MESSAGE_THREADS: MockThread[] = [
  {
    bookingId: "bkg_1",
    /*
      NO unread on this one, and that is a decision about the test suite rather
      than about the fixture.

      Reading a conversation marks it read, and it is not reversible. Half a
      dozen tests open this booking to exercise the composer, the paging and the
      removed text, so any unread here would be cleared by whichever ran first
      and the strip test would be racing them. `bkg_card` carries the unread
      instead, and nothing else in the suite opens it.
    */
    unread: 0,
    messages: [
      /*
        Longer than ONE PAGE, and that is the whole reason the filler is here.

        The endpoint's first page is the 50 most recent messages and `nextCursor`
        walks backwards through what came before, which is the opposite of how a
        list usually reads. A conversation that fitted on one page would let a
        client ship that backwards and nothing would notice, so this one does not
        fit: the eleven written out below are the most recent, and the generated
        block before them pushes the opening past the first page.

        Generated rather than typed, because forty-five lines of invented small
        talk would bury the eleven that carry the branches.
      */
      ...earlierChat(45),
      {
        id: "msg_1_01",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Hello, we are two people booked for the dawn dive.",
        sentAt: todayAt("18:02", -3),
      },
      {
        id: "msg_1_02",
        from: "operator",
        senderName: "Priya Raut",
        text: "You are on the list. Be at Beach 3 dive hut by 06:30.",
        sentAt: todayAt("18:20", -3),
      },
      {
        id: "msg_1_03",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Is there somewhere to leave a bag?",
        sentAt: todayAt("09:15", -2),
      },
      {
        id: "msg_1_04",
        from: "operator",
        senderName: "Priya Raut",
        text: "Yes, the hut has lockers. Bring your own padlock if you can.",
        sentAt: todayAt("09:40", -2),
      },
      {
        id: "msg_1_05",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Perfect, thank you.",
        sentAt: todayAt("09:44", -2),
      },
      {
        id: "msg_1_06",
        from: "operator",
        senderName: "Dev Kapoor",
        /*
          A second name on the business's side. "The name of the person on the
          team who wrote it" — the traveller sees the business, the business sees
          who answered, and a screen showing one name for every outgoing message
          would hide which colleague already replied.
        */
        text: "Dev here, covering the morning. Anything else, just ask.",
        sentAt: todayAt("07:05", -1),
      },
      {
        id: "msg_1_07",
        from: "traveller",
        senderName: "Asha Menon",
        text: "One of us has not dived since last year. Is that a problem?",
        sentAt: todayAt("19:30", -1),
      },
      {
        id: "msg_1_08",
        from: "operator",
        senderName: "Priya Raut",
        text: "Not at all. We will run through the basics before we go in.",
        sentAt: todayAt("19:55", -1),
      },
      {
        id: "msg_1_09",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Great. What time should we actually arrive?",
        sentAt: todayAt("05:10"),
      },
      {
        /*
          The first of the two unread ones, and the reason `unread` is 2: the
          count is the TRAVELLER's messages nobody has marked read, so the two
          newest from her are it.
        */
        id: "msg_1_10",
        from: "traveller",
        senderName: "Asha Menon",
        text: "Also, do you have fins in size 44?",
        sentAt: todayAt("05:12"),
      },
      {
        id: "msg_1_11",
        from: "traveller",
        senderName: "Asha Menon",
        text: "We are on our way now.",
        sentAt: todayAt("05:40"),
      },
    ],
  },
  {
    /*
      One of the two conversations with anything UNREAD (Hana's, below, is the
      other, answered from Home), and the one the unread chip is asserted
      against.

      Two messages, both from the traveller, both after the last thing the
      business said: `unreadCount` is "the traveller's messages nobody at the
      business has marked read", so a reply of ours in between would be counted
      by nobody and the number would not be two.
    */
    bookingId: "bkg_card",
    unread: 2,
    messages: [
      {
        id: "msg_card_01",
        from: "operator",
        senderName: "Priya Raut",
        text: "You are booked. Meet us at the counter twenty minutes before.",
        sentAt: todayAt("16:00", -1),
      },
      {
        id: "msg_card_02",
        from: "traveller",
        senderName: "Sofia Alves",
        text: "Is the counter the same one as the ticket office?",
        sentAt: todayAt("06:05"),
      },
      {
        id: "msg_card_03",
        from: "traveller",
        senderName: "Sofia Alves",
        text: "I am running about ten minutes behind.",
        sentAt: todayAt("06:20"),
      },
    ],
  },
  {
    /*
      The conversation answered from HOME (operator experiment A): one
      message, unread, from the traveller paying at the counter on the 20:30.
      Hana's booking because no other test writes to it or reads it.

      Reading it is not reversible, and the mock's state is shared by both
      Playwright projects, so ONE test reads it: the mobile project's, in the
      same serial block as the strip test that reads Sofia's, which is what
      lets that block count both.
    */
    bookingId: "bkg_cash_today",
    unread: 1,
    messages: [
      {
        id: "msg_today_01",
        from: "traveller",
        senderName: "Hana Ito",
        text: "Can I pay you in cash at the jetty?",
        sentAt: todayAt("05:30"),
      },
    ],
  },
  {
    bookingId: "bkg_2",
    unread: 0,
    closedReason: "cancelled",
    messages: [
      {
        id: "msg_2_01",
        from: "traveller",
        senderName: "Daniel Okafor",
        text: "Sorry, something has come up and I need to cancel.",
        sentAt: todayAt("14:00", -2),
      },
      {
        id: "msg_2_02",
        from: "operator",
        senderName: "Priya Raut",
        text: "No problem at all. Come and see us next season.",
        sentAt: todayAt("14:06", -2),
      },
    ],
  },
  {
    bookingId: "bkg_3",
    unread: 0,
    closedReason: "window_closed",
    messages: [
      {
        id: "msg_3_01",
        from: "operator",
        senderName: "Priya Raut",
        text: "Thanks for coming out with us. Hope the photos came out well.",
        sentAt: todayAt("16:00", -30),
      },
    ],
  },
  {
    /*
      `bkg_4` rather than an id nothing else knows: a thread has to resolve to a
      real booking for the list to carry its reference, its experience and its
      departure, and inventing one would give the conversations list a row that
      opens a 404.
    */
    bookingId: "bkg_4",
    unread: 0,
    closedReason: "window_closed",
    messages: [
      {
        id: "msg_4_01",
        from: "traveller",
        senderName: "Rhea Kapoor",
        /*
          No `text`. Removed "a set time after the trip ends (90 days unless the
          service is configured otherwise)", and the message stays: who wrote it,
          when, and this field in place of the words.
        */
        textRemovedAt: todayAt("03:00", -1),
        sentAt: todayAt("11:20", -95),
      },
      {
        id: "msg_4_02",
        from: "operator",
        senderName: "Priya Raut",
        textRemovedAt: todayAt("03:00", -1),
        sentAt: todayAt("11:31", -95),
      },
    ],
  },
];
