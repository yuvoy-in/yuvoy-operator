/**
 * What `checkInWithCode` answers, outside the `"use server"` file because a
 * Server Actions module may export async functions only.
 */

export type CheckInVia = "portal_link" | "typed";

export type CheckInResult =
  | {
      ok: true;
      bookingId: string;
      reference: string;
      name: string;
      guests: number;
      slotId: string;
      arrivedAt: string;
      alreadyCheckedIn: boolean;
    }
  | {
      ok: false;
      message: string;
      /** Offer checking them in by name on Today instead. */
      byName?: boolean;
      /**
       * Sending the same again can help: no signal, a send still being
       * written, a fault of ours. Never on a code that missed (404, a
       * mismatch, 429), because every miss counts toward the operator's 30
       * an hour, and never after a lost answer, which may have gone through.
       */
      retry?: boolean;
      /** This key can never be sent again; the next try gets a new one. */
      newKey?: boolean;
      /** The session has ended: sign in, then come back to this check-in. */
      signIn?: boolean;
    };

/** What the screen says when the answer never came back. */
export const UNSENT =
  "No signal, so we do not know yet if that went. Try again: they are only checked in once.";

/** Said before anything is sent when the code cannot be one, and after. */
export const NOT_A_CODE =
  "That is not a check-in code. It is 8 letters and numbers, like K7QM-2XPA.";
