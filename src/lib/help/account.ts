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
  {
    id: "cash-owed",
    area: "Money",
    question: "When is Yuvoy's share of cash owed?",
    answer: [
      "Once the trip is done and you have recorded the cash. A trip finishes on its own six hours after it ends.",
      "Cash you take for a trip that has not run yet is held. It is yours, and Yuvoy's share of it becomes owed when the trip is done.",
      "The share is worked out on the fare, not on what you chose to take. A discount you gave is yours to have given.",
    ],
  },
  {
    id: "cash-unrecorded",
    area: "Money",
    question: "What is a past cash trip with no payment recorded?",
    answer: [
      "A cash trip that ended more than six hours ago with no cash recorded. Nothing says whether you were paid, so it is in none of the figures on Money or Cash.",
      "Only you can close it: record the cash if you took it, or mark the party a no-show if they did not come.",
    ],
  },
  {
    id: "settling-cash",
    area: "Money",
    question: "How do I pay Yuvoy's share of cash?",
    answer: [
      "There is no pay button, on purpose. You took this money directly, so there is no payout for Yuvoy's share to come out of. It is a balance instead, with every trip behind it listed so every rupee is checkable.",
      "Settling up happens between you and a person at Yuvoy, not through the portal, so the number is never a surprise when it does.",
    ],
  },
];
