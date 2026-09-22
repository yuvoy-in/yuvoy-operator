import type { HelpTopic } from "./types";

/**
 * Help for Bookings, messages, Calendar, listings and the departure screen.
 *
 * One file per area of the portal, so each can grow without touching the
 * others. `index.ts` puts them together.
 *
 * Every answer here was a sentence on a screen, cut because it explained the
 * screen rather than changing what somebody does next (yuvoy-operator#80 t4).
 * Written as the operator would ask it, and answered in the same plain words
 * the screens use: a departure is a dated trip, a listing is what you sell.
 */
export const OPERATING_HELP: readonly HelpTopic[] = [
  {
    id: "traveller-messages",
    area: "Bookings",
    question: "Where do messages from travellers show up?",
    answer: [
      "Every booking has its own conversation. When a traveller writes, the conversation moves to the top of Conversations, and the booking shows it too.",
      "Neither side can send a phone number, an email address or a link. To tell everybody on a departure something at once, use Message everyone booked on that departure.",
    ],
  },
  {
    id: "traveller-phone-numbers",
    area: "Bookings",
    question: "Why can I not see a traveller's phone number?",
    answer: [
      "A traveller gives Yuvoy their number so we can tell them about their booking. We do not pass it on, and neither side can type one into a conversation.",
      "To find somebody at the jetty, ask for their booking reference: it is on their booking page and in every message we send them. To reach them, write in the booking's conversation, or use Message on the departure, which sends an approved message and keeps a record of what was said.",
    ],
  },
  {
    id: "cash-bookings",
    area: "Bookings",
    question: "How does a booking paid in cash work?",
    answer: [
      "The traveller hands you the fare on the day. None of it passes through Yuvoy, so there is no payout on a cash booking.",
      "Record it when you take it, with Take on the booking or on the departure. If they paid a different amount, record what you actually took: it is recorded once and cannot be changed afterwards.",
      "Yuvoy's share of a cash booking is worked out on the fare once the trip is done, and is shown beside the cash you have collected.",
    ],
  },
  {
    id: "still-paying",
    area: "Bookings",
    question: "Who are the people under Still paying on a departure?",
    answer: [
      "Travellers who are part way through paying. They hold seats for a few minutes, and they have no booking yet.",
      "They may finish paying and turn up, or the hold may run out and the seats come back. Keep them in mind at the jetty, but do not check them in: there is nothing to check in until they have paid.",
    ],
  },
  {
    id: "calling-off",
    area: "Calendar",
    question: "What happens when I call a departure off?",
    answer: [
      "Every booking on it is cancelled, and everything the travellers paid online is refunded in full, whatever the cancellation terms. Seats being held are released, and we message everyone booked.",
      "Anyone who paid you in cash gets it back from you, because none of it reached us. The departure lists who, and you record each one once you have handed the money back.",
      "It cannot be undone, which is why you type the departure's id to confirm it rather than ticking a box. To stop new bookings and keep the people already booked, stop selling the departure instead.",
    ],
  },
  {
    id: "booking-money",
    area: "Money",
    question: "Why do my bookings not add up to a month of earnings?",
    answer: [
      "The figures on a booking are the ones earnings are made of, frozen when the money moved, for that booking alone.",
      "Earnings count by when the money moved, and bookings are listed by when the trip runs. A booking made in March for a trip in April is in March's earnings and April's list, so a screen of bookings will not add up to a month.",
    ],
  },
];
