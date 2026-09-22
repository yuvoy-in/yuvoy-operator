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
];
