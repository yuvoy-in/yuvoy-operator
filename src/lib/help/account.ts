import type { HelpTopic } from "./types";

/**
 * Help for Money, the business profile, settings, verification, team and story.
 *
 * One file per area of the portal, so each can grow without touching the
 * others. `index.ts` puts them together.
 *
 * Every answer here is an explanation that used to sit on a screen beside the
 * control it explains (yuvoy-operator#80 t4), moved rather than rewritten: the
 * facts are the ones the screens stated, which are the contract's.
 */
export const ACCOUNT_HELP: readonly HelpTopic[] = [
  /* ---------------------------------------------------------- Money --- */
  {
    id: "how-payouts-work",
    area: "Money",
    question: "How is a payout worked out?",
    answer: [
      "A payout week runs Monday to Sunday. A booking belongs to the week its trip ran in, not the week it was paid for.",
      "A card trip marked complete or a no-show is paid its fare, less Yuvoy's share and anything refunded. A cancelled card booking is paid what you kept of it, and Yuvoy takes no share of it.",
      "A week can be locked for payment from the Monday after it. Three people at Yuvoy lock, approve and send it, and your bank decides when the transfer lands.",
      "A correction is your share of a refund issued after an earlier payout, taken off this one. When a correction is larger than what a week pays, that week is not paid until Yuvoy has agreed with you how to settle it.",
    ],
  },
  {
    id: "booked-not-run",
    area: "Money",
    question: "Why is a card booking not in my payout yet?",
    answer: [
      "It is earned once its trip is marked complete or a no-show, and it is then paid with the week the trip ran in.",
      "Until then it is under Booked, not run yet, and it is in no payout and no total.",
    ],
  },
  {
    id: "cash-not-in-payout",
    area: "Money",
    question: "Why is cash not in my payout?",
    answer: [
      "A traveller who pays in cash pays you on the day, so that money never passes through a payout.",
      "Yuvoy's share of it is a balance instead, listed trip by trip on Cash you've collected.",
    ],
  },
];
