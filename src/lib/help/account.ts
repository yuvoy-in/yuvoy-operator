import { OPERATOR_ROLES, describeRole } from "@/lib/team/roles";
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

/**
 * What each role may do, read from `describeRole` rather than copied.
 *
 * Every line is a promise about access, and an owner hands a crew phone to a
 * skipper on the strength of one. Two copies of a promise drift, and the copy
 * that drifts here would be the one nobody is looking at. The disclosure on
 * Team reads the same function, and every claim in it is taken from
 * `contracts/operator-openapi.yaml`.
 */
const ROLE_ANSWER: readonly string[] = OPERATOR_ROLES.flatMap((role) => {
  const described = describeRole(role);
  if (!described) return [];
  const cannot = described.cannot ? ` ${described.cannot}` : "";
  return [`${described.label}. ${described.can}${cannot}`];
});
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
  {
    id: "bank-change-two-days",
    area: "Money",
    question: "Why does changing the bank account take two days?",
    answer: [
      "It is slow on purpose. A stolen login plus one convincing phone call would otherwise be enough to redirect a season's takings.",
      "Raising a change changes nothing that day. For 24 hours an owner or an admin can stop it from Payout details. A person at Yuvoy then reviews it, and it goes live 24 hours after they approve it, still stoppable the whole time.",
      "Only an owner can raise one, and the code it needs is emailed to the owner, whoever asks. While a change is open, payouts wait until it is settled.",
    ],
  },
  {
    id: "bank-last-four",
    area: "Money",
    question: "Why does Yuvoy keep only the last four digits of my account?",
    answer: [
      "Nothing in the portal pays anybody, so holding the whole account number would be a risk with nothing gained. We will call you to confirm the account number.",
    ],
  },

  /* ------------------------------------------------------- Business --- */
  {
    id: "why-business-details",
    area: "Business",
    question: "Why does Yuvoy need my registered name and address?",
    answer: [
      "An invoice and a payout both need the name the business is registered under, and where. Asking now beats chasing them on the day your first payout runs.",
      "Travellers never see them. What they read about you is Your story.",
    ],
  },
  {
    id: "who-checks",
    area: "Business",
    question: "Who checks what I send?",
    answer: [
      "A person at Yuvoy checks each thing waiting on you, and each document. Nothing you send verifies itself, and nothing about your account changes until they have.",
      "If one was turned down, the reason is not shown in the portal yet. Call us and we will tell you.",
    ],
  },
  {
    id: "not-stopping-sales",
    area: "Business",
    question: "What does Not stopping sales mean?",
    answer: [
      "Some of what we ask for, like a logo or a registered address, is needed but does not stop travellers booking you. Documents and your account's status do.",
      "A thing marked Not stopping sales can be finished when you have a moment. The others are costing you bookings until they are done.",
    ],
  },
  {
    id: "document-expiry",
    area: "Business",
    question: "When do I hear that a document is running out?",
    answer: [
      "Two months before its expiry date, on Verification. That is also when we start taking the new one.",
      "An expired document stops your departures selling on the day it runs out.",
    ],
  },
  {
    id: "where-logo-appears",
    area: "Business",
    question: "Where do travellers see my logo?",
    answer: [
      "On your card in the app, shown whole rather than cropped, and on the page about your business.",
      "Once your account is live, a person here looks at a new logo before it replaces the one travellers see.",
    ],
  },
  {
    id: "what-travellers-see",
    area: "Business",
    question: "What do travellers read about my business?",
    answer: [
      "Your story: what you write about yourself, the languages your crew speaks, your photographs, and the two facts Yuvoy has checked.",
      "Your registered name and address are not on it. They are under Business details, where an invoice and a payout need them, and travellers never see them.",
    ],
  },
  {
    id: "story-photographs",
    area: "Business",
    question: "What should the photographs on my page show?",
    answer: [
      "The boat, the shop, the crew. Not the trip itself: footage of the experience belongs on a listing's reel, which is where travellers look for it.",
      "Five at most. Your page shows no photographs until you add one.",
    ],
  },
  {
    id: "story-languages",
    area: "Business",
    question: "Why do the languages my crew speaks matter?",
    answer: [
      "For a traveller who is nervous in the water, this is often what decides it.",
      "Separate them with commas: English, Hindi, Bengali. Eight at most.",
    ],
  },

  /* ----------------------------------------------------------- Team --- */
  {
    id: "what-each-role-can-do",
    area: "Team",
    question: "What can each role do?",
    answer: ROLE_ANSWER,
  },
  {
    id: "why-roles-differ",
    area: "Team",
    question: "Why are the roles different?",
    answer: [
      "The crew phone goes out on the boat and gets left on a bench. It should be able to check people in on a departure and nothing else.",
      "Payout details are the owner's alone. A stolen manager login plus one convincing phone call is otherwise enough to redirect a season's takings.",
      "Who is on the account is an owner's or an admin's, because an owner who is off the island cannot be the only person who can let somebody in.",
      "Making somebody an owner hands them the payout details too. An admin who does it cannot change that person's access afterwards.",
    ],
  },
  {
    id: "removing-somebody",
    area: "Team",
    question: "What happens when I remove somebody?",
    answer: [
      "Their sessions end immediately, on the next thing they tap, not at their next sign-in. That is the difference between removing somebody now and removing them a fortnight from now.",
      "Their name comes off the list, and you can invite them again afterwards.",
      "Pausing is the smaller one. It stops the login and keeps the person, their role and their history, and you can give access back from the same row.",
      "Revoking an invitation nobody has accepted is a different thing again: the invitation and its code stop working, and nobody ever had access to end.",
    ],
  },
];
