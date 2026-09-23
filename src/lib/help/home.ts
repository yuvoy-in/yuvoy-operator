import type { HelpTopic } from "./types";

/**
 * Help for Home, the tab bar and the header.
 *
 * One file per area of the portal, so each can grow without touching the
 * others. `index.ts` puts them together.
 *
 * These are the explanations Home does not carry on screen (yuvoy-operator#80
 * t4): the screen keeps the fact and the one sentence that changes a
 * decision, and the reasons behind them live here, where somebody who wants
 * them reads them once.
 */
export const HOME_HELP: readonly HelpTopic[] = [
  {
    id: "selling-line",
    area: "Home",
    question: "What does the line at the top of Home mean?",
    answer: [
      'It says whether travellers can book you right now. "Selling" means your account can take bookings and at least one listing is live. "Selling, but" means you are selling and something is costing you sales, such as departures off sale or a live listing with no dates. "Not selling" means nobody can book you until the thing it names is done.',
      "Tap the line to see every reason, each with the place where it is put right.",
    ],
  },
  {
    id: "seats-not-confirmed",
    area: "Home",
    question: "Why are some departures off sale when I did not close them?",
    answer: [
      "Seats you set by hand stop being offered to travellers once nobody has confirmed them for two days, so a count you set weeks ago cannot sell seats you no longer have.",
      "Confirm all on Home confirms every departure in the next 30 days, on every listing, and changes no seat counts. A listing's own page confirms just that listing's. You also get an email once a day listing any departures that are off sale or about to go off sale, unless you turn it off in your notifications.",
    ],
  },
  {
    id: "no-dates-to-sell",
    area: "Home",
    question: 'What does "no dates in the next 30 days" mean?',
    answer: [
      "The listing is live on the traveller app, and there is no day in the next 30 on which a traveller could book it: no departure, or every departure closed, full, past its booking cutoff, called off or off sale for unconfirmed seats.",
      "Add departures, or confirm the seats on the ones you have. A listing whose first date is further out than 30 days can still be booked for that date; this is a warning window, not the traveller's calendar.",
    ],
  },
  {
    id: "departures-on-home",
    area: "Home",
    question: "Why is a departure missing from today on Home?",
    answer: [
      "Home lists the departures somebody could be on. A called-off departure is left out, because every booking on it was cancelled. So is a departure on a listing that has never been on sale, and one closed to new bookings with nobody booked on it.",
      "A departure with people booked on it always stays, closed or not, because those people are still coming. Every departure is on Calendar.",
    ],
  },
  {
    id: "money-line",
    area: "Home",
    question: "What does the money line on Home say?",
    answer: [
      "The first figure is what your next payout would pay if it were worked out now, for the week it covers: this week, or last week until that week is locked for payment. It can still change until then.",
      '"Payout from" is the first day that week can be paid. Yuvoy pays it on that day or after, and your bank decides when it lands. "Cash owed to Yuvoy" is our commission on cash you have taken for trips that are done.',
    ],
  },
  {
    id: "unrecorded-cash",
    area: "Home",
    question: "What are past cash trips with no payment recorded?",
    answer: [
      "Trips paid at your counter that ran more than six hours ago, where nobody recorded taking the cash. Nothing tells us whether you were paid, so they are in none of your money figures.",
      "Record the cash if you took it, and it becomes owed once the trip is done. If the party did not come, mark them a no-show, and nothing is owed.",
    ],
  },
  {
    id: "inbox-count",
    area: "Home",
    question: "What does the number on the inbox mean?",
    answer: [
      "How many guests have written something nobody at your business has read. A guest who sends three messages counts once, because it is one reply to write. It clears when somebody opens the conversation.",
    ],
  },
  {
    id: "money-tab",
    area: "Home",
    question: "Why can I not see the Money tab?",
    answer: [
      "Money is shown to owners, admins and managers. A staff login runs the day, such as today's departures and who has arrived, and does not see what the business is paid. Ask an owner, an admin or a manager if you need a figure.",
    ],
  },
];
