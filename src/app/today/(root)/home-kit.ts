/**
 * What the home test files share (yuvoy-operator#178). Not a test file
 * itself: only `*.test.tsx` files are collected. The mocks, the imports of
 * the components and the cleanup stay in each test file, since `vi.mock` is
 * per file.
 */
import type { Need } from "@/lib/home/needs";
import type { RequestView } from "@/lib/day/request-view";

export const VIEW: RequestView = {
  id: "req_1",
  name: "Reuben Mathai",
  firstName: "Reuben",
  guests: 3,
  title: "Reuben Mathai, 3 people",
  trip: "Snorkel trip · Sat 09:00",
  experience: "Snorkel trip",
  when: "Sat 09:00",
  asked: "Asked 2 h ago · Answer by 07:20",
  clock: "1h 20m left",
  urgent: false,
  seats: "6 seats you can still give",
  short: false,
  preset: null,
  timezone: "Asia/Kolkata",
};

export const REQUEST: Need = {
  kind: "request",
  key: "request-req_1",
  view: VIEW,
};

export const SEATS: Need = {
  kind: "confirm-seats",
  key: "confirm-seats",
  text: "19 departures are off sale: seats not confirmed",
};

export const MESSAGE: Need = {
  kind: "message",
  key: "message-bkg_card",
  bookingId: "bkg_card",
  reference: "YV-CARD6N7P",
  unread: "2 new",
  trip: "Try-dive at Nemo Reef · Today at 11:30",
  experience: "Try-dive at Nemo Reef",
  when: "Today at 11:30",
};

export const CASH: Need = {
  kind: "cash",
  key: "cash-slot_9",
  slotId: "slot_9",
  text: "Collect ₹4,500 on the 11:30",
  detail: "Try-dive at Nemo Reef · 1 party",
  experience: "Try-dive at Nemo Reef",
  partyCount: "1 party",
  timezone: "Asia/Kolkata",
  parties: [
    {
      bookingId: "bkg_kavya",
      name: "Kavya Iyer",
      reference: "YV-C4SH1A2B",
      guests: 1,
      state: "confirmed",
      cash: { collectPaise: 450_000, collected: false },
    },
  ],
};

export const props = {
  canAnswer: true,
  canAccept: true,
  nextUp: null as string | null,
};
