import type { PartyForClient } from "@/lib/day/types";
import type { ScreeningSignal } from "@/lib/day/screening";
import type { BookingCash } from "@/lib/money/bookings";

/** What `PartyRow` takes, moved out of party-row.tsx (yuvoy-operator#178). */
export type PartyRowProps = {
  /**
   * The screener is NOT on this type. It is decided on the server and arrives
   * as `screening` below — see `PartyForClient` for why the difference
   * matters on a page whose source anybody can read.
   */
  party: PartyForClient;
  slotId: string;
  /** Terminal outcomes are refused before the departure time. */
  departed: boolean;
  /**
   * What this row should say about the medical question, in one word.
   *
   * Decided for the whole manifest at once rather than inferred here: a row
   * carrying no screener looks identical on a snorkel trip (nobody was ever
   * going to be asked) and on a dive (somebody slipped through), and only the
   * other rows can tell them apart.
   *
   * `null` renders nothing whatsoever — not a reassurance and not a warning.
   * "A false alarm on this signal teaches an instructor to skip the column."
   */
  screening: ScreeningSignal;
  /**
   * How this party is paying — yuvoy-operator#40 §1. Required, so a manifest
   * cannot forget to say.
   *
   *   `BookingCash`  paying at the counter: the fare, and whether it is taken
   *   `null`         not a cash booking — paid online, or a hold
   *
   * There is no third "could not tell" any more. It existed for a second read
   * that could miss a booking; the manifest carries each party's cash itself
   * since yuvoy-api#204 (op#95).
   */
  cash: BookingCash | null;
  /** The departure's own zone, for when the cash was taken. */
  timezone: string;
  /**
   * The signed-in person may cancel a booking — yuvoy-operator#56 item 10.
   *
   * `POST /bookings/{id}/cancel` "requires OWNER, ADMIN or MANAGER, the roles
   * that may call a departure off", and a STAFF login gets no control rather
   * than a refusal after the tap. It stays drawn for a SUSPENDED business,
   * which can still stop the trips it has already sold (#50).
   */
  canManage: boolean;
  /**
   * The party's booking, with this departure as its way back (audit 5.2: a
   * manifest row never opened its booking). Absent on a hold, which has none.
   */
  bookingHref?: string;
  /**
   * Their unread messages, from the conversations list until the manifest
   * carries it (yuvoy-api#260). Absent when that list could not be read.
   */
  unread?: number;
};
