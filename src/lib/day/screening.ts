import type { Party } from "./types";

/**
 * The medical screener, as far as a manifest may say anything about it.
 *
 * ## What this is for, and it is not the obvious thing
 *
 * Not "who has a heart condition". A booking is refused outright on a declared
 * condition, so everybody on a manifest declared clear — what can still go
 * wrong is **somebody arriving having never been asked**, and that is the case
 * an instructor cannot recover at the jetty and could not see anywhere before
 * this (yuvoy-operator#17).
 *
 * ## Three rules the contract states, kept here so no screen can drift from them
 *
 * 1. **Absent means the question does not apply.** `screening` is "present
 *    only on listings that ask a medical question" — a snorkel trip has no
 *    screener, and rendering "not screened" against a party nobody was ever
 *    going to ask is a false alarm. "A false alarm on this signal teaches an
 *    instructor to skip the column", which is worse than having no column.
 * 2. **Nothing here ever carries what anybody disclosed.** "A manifest is read
 *    on a jetty, out loud, in front of other customers." `clear` is therefore
 *    read by nothing in this file and rendered by nothing in this portal — the
 *    only reason it is in the type at all is that the contract sends it.
 * 3. **`needsAttention` is the server's, not ours.** It is "computed
 *    server-side so a phone, a printout and the admin console cannot disagree
 *    about who to stop", so it is passed through and never derived from
 *    `declared` and `clear`.
 *
 * `answeredVersion` is "reported, not compared" — the listing carries no
 * version of its own, so a "the question changed" flag would have nothing
 * behind it. Nothing here reads it.
 */

/**
 * Does this departure ask a medical question at all?
 *
 * Answered from the parties rather than from the listing, because the listing
 * is not on the manifest — presence of the field IS the signal, per the
 * contract. One party carrying it is enough: the screener belongs to the
 * listing, so if it applied to anybody it applied to the departure.
 *
 * Everything else in this file is meaningless when this is false, and the
 * screen renders nothing at all rather than a reassurance.
 */
export function departureAsksScreening(parties: readonly Party[]): boolean {
  return parties.some((party) => party.screening !== undefined);
}

/**
 * Have we got no answer on record for this party?
 *
 * Two shapes mean the same thing to somebody standing on a dock, and they are
 * deliberately NOT told apart on screen:
 *
 *   - `declared: false` — asked, has not answered.
 *   - `screening` absent while other parties on the departure carry it — a
 *     booking made before the screener was added to the listing, most likely.
 *     The contract's model says this should not happen (presence is decided by
 *     the listing), so it is data this portal cannot interpret confidently.
 *
 * Both are counted as outstanding, and the asymmetry is why. Flagging a party
 * who did answer costs an instructor ten seconds of asking again. Not flagging
 * one who never answered is precisely the failure this feature exists to
 * prevent. So the ambiguous case goes in the loud direction.
 *
 * **Only meaningful on a departure that asks.** Called against one that does
 * not, every party looks outstanding — which is the false alarm rule 1
 * forbids. Callers gate on {@link departureAsksScreening} first, and
 * {@link screeningSummary} does it for them.
 */
export function isScreeningOutstanding(party: Party): boolean {
  return party.screening?.declared !== true;
}

/**
 * The one thing to highlight on a row, straight from the server.
 *
 * Never derived. A phone that computes its own answer from `declared` and
 * `clear` is a phone that disagrees with the printout, and the disagreement
 * surfaces as two people being stopped and one not.
 */
export function needsAttention(party: Party): boolean {
  return party.screening?.needsAttention === true;
}

/**
 * What one row should say, decided on the SERVER and reduced to a word.
 *
 * ## Why this is not left to the row component
 *
 * `PartyRow` is a client component, so every prop it takes is serialised into
 * the RSC payload inside the HTML. Handing it the whole party put `clear` —
 * what somebody answered about their own health — into the page source of a
 * screen whose contract says it "never carries what anybody disclosed", along
 * with `answeredVersion`, which is "reported, not compared" and belongs on no
 * screen at all. Found by asserting against the served HTML rather than the
 * visible text; nothing was rendering either field, and both were shipping.
 *
 * Collapsing the decision to one word here means there is no `clear` in the
 * browser to leak, to render by accident, or to derive a second opinion from.
 * The invariant stops being a thing to remember and becomes a thing the type
 * system will not let you break.
 *
 * `null` on a departure that asks nothing, and on a party who answered with
 * nothing flagged — those two say nothing for different reasons and the row
 * treats them identically, which is correct: neither gets a line.
 */
export type ScreeningSignal = "flagged" | "outstanding" | null;

export function screeningSignal(
  party: Party,
  asksScreening: boolean,
): ScreeningSignal {
  if (!asksScreening) return null;
  // Flagged wins. Both apply to "somebody arriving having never been asked",
  // which the contract names as the interesting case, and two lines on one row
  // would bury the one that says to stop them.
  if (needsAttention(party)) return "flagged";
  return isScreeningOutstanding(party) ? "outstanding" : null;
}

export interface ScreeningSummary {
  /** Whether to render anything about screening at all. */
  asks: boolean;
  /** Parties with no answer on record. */
  outstanding: number;
  /** Every party on the manifest, holds included. */
  total: number;
  /** Parties the server has flagged. */
  flagged: number;
}

/**
 * The line that sits above the list.
 *
 * A row-level flag alone cannot tell a departure that asks the question **with
 * nobody outstanding** from one that **never asks it** — both render a list of
 * unmarked rows. That ambiguity is the whole reason for a summary, so the
 * zero case is stated out loud rather than left as an absence.
 *
 * ## The denominator is the rows on screen, not `totals.parties`
 *
 * `totals` is computed server-side and this is not, so tying them together
 * would let the screen claim "2 of 8" above a list of seven. Counting the
 * array the list renders keeps the sentence checkable by the person reading
 * it, which is the only way anybody would ever catch it being wrong.
 *
 * Holds are included for the same reason they are on the manifest at all: "a
 * party mid-checkout at 08:40 may walk up at 08:55", and one who walks up
 * having never answered is the case this exists for.
 */
export function screeningSummary(parties: readonly Party[]): ScreeningSummary {
  const asks = departureAsksScreening(parties);
  if (!asks) {
    return { asks: false, outstanding: 0, total: parties.length, flagged: 0 };
  }
  return {
    asks: true,
    outstanding: parties.filter(isScreeningOutstanding).length,
    total: parties.length,
    flagged: parties.filter(needsAttention).length,
  };
}
