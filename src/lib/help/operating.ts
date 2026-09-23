import type { HelpTopic } from "./types";

/**
 * Help for Bookings, messages, Calendar, listings and the departure screen.
 *
 * Pausing is here rather than beside the control (yuvoy-operator#85 s8): what
 * it does not do is three paragraphs, and three paragraphs above a destructive
 * button is a screen nobody finishes reading.
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
    id: "not-on-sale",
    area: "Calendar",
    question: "Why is a departure not on sale?",
    answer: [
      "Open the departure in Calendar: it says why, in a sentence. A day with a departure that should be selling and is not carries a mark, such as 2 not on sale, so you can see it without opening every day.",
      "The usual reasons are seats nobody has confirmed for two days, a document that is missing or has lapsed, or the whole business not selling yet. Confirm the seats in Calendar; the others are put right in Business.",
      "A departure you stopped selling, one you called off, one past its booking cutoff and one that is full are not marked: those are decisions already made, or the day working as it should.",
    ],
  },
  {
    id: "confirming-seats",
    area: "Calendar",
    question: "Why do seats need confirming?",
    answer: [
      "Seats you set by hand stop being offered to travellers once nobody has confirmed them for two days, so that a boat nobody is watching does not keep selling.",
      "Confirming keeps the seat count exactly as it is and puts the departure back on sale, unless something else keeps it off. Setting the seats again does the same. Confirm seats for the next 30 days does it for every departure at once.",
      "Departures made from a weekly schedule, and departures where you answer each request, are never taken off sale for this.",
    ],
  },
  {
    id: "counter-sales",
    area: "Calendar",
    question: "What does recording a counter sale do?",
    answer: [
      "It tells us how many seats you sold yourself, at your own counter, so we stop selling them. It is a report rather than a request.",
      "It is recorded even when it oversells the departure, because refusing it would not un-sell the seats. If it does, the screen says so, names the bookings affected and gives an incident number to quote. Sort the seats out before the boat leaves.",
    ],
  },
  {
    id: "closing-dates",
    area: "Calendar",
    question: "Does closing a day or stopping a departure cancel the bookings?",
    answer: [
      "No. Closing a day, closing dates or stopping one departure stops new bookings straight away, and every booking already made stays. The travellers still expect you, so resolve each of them in Bookings.",
      "To cancel a departure and refund everybody on it, call it off from the departure itself. You can reopen a closed day or departure from the day in Calendar.",
    ],
  },
  {
    id: "instant-or-request",
    area: "Calendar",
    question:
      "What is the difference between instant booking and answering each request?",
    answer: [
      "With instant booking, Yuvoy holds the seats and travellers book them straight away. The seats left on a departure are the ones we can still sell.",
      "When you answer each request, nothing is held: a traveller asks, you accept or decline, and they pay only after you accept. The number left is how many more people the departure can take.",
    ],
  },
  {
    id: "pausing-a-listing",
    area: "Listings",
    question: "What happens when I pause a listing?",
    answer: [
      "It stops being offered to travellers straight away. Departures still to come keep their rows and stop selling.",
      "Nothing is cancelled and nothing is refunded. Every booking you already have still stands, and those travellers still expect their trip.",
      "Resume puts it back on sale yourself, in one tap, with nothing to wait for. If something on your account stops sales, the listing says so, and resuming does not change that.",
      "Pausing is refused while somebody holds unpaid seats on the listing, or a request on it is waiting for your answer. The refusal says when the hold ends and how many requests to answer first.",
      "To cancel a departure and refund the people on it, open that departure and call it off instead: one at a time, each confirmed on its own.",
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
