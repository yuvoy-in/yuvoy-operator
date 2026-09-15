/**
 * What one reel's sheet offers — yuvoy-operator#58 item 6.
 *
 * The actions are decided from `situation` and nothing else. That field is
 * computed server side precisely so three clients cannot disagree about it:
 * "deriving the situation from two enumerations client side gets it wrong in
 * ways nobody notices for a month." A sheet that offers Confirm rights on a
 * clip the API will refuse teaches an operator to distrust every button on it.
 *
 * An unknown `situation` offers NOTHING but Take it down, which is the safe
 * direction: it is the one action the API allows from every state except
 * `withdrawn`, and a build meeting a situation it has not heard of must not
 * guess that publishing is available.
 */

/** Which controls the sheet draws. Each is a separate decision. */
export interface SheetActions {
  /** The reviewer's reason, from `rejection`. */
  whyDeclined: boolean;
  /** `POST /media/{id}/rights`, via the existing `RightsForm`. */
  confirmRights: boolean;
  /** `POST /media/{id}/publish` onto a DIFFERENT listing. */
  putOnAnother: boolean;
  /** `POST /media/{id}/publish` with the listing it is already on. */
  coverOrGallery: boolean;
  /** Opens the Add a reel sheet with this listing set. */
  replace: boolean;
  /** `POST /media/{id}/withdraw`. */
  takeDown: boolean;
}

const ON_A_LISTING = ["live", "waiting_on_listing", "listing_withdrawn"];

export function sheetActions(item: {
  situation?: string;
  listing?: { experienceId?: string };
}): SheetActions {
  const situation = item.situation ?? "";
  const attached = ON_A_LISTING.includes(situation);
  return {
    whyDeclined: situation === "changes_needed",
    confirmRights: situation === "needs_rights",
    putOnAnother: attached || situation === "not_attached",
    /*
      Only when we know WHICH listing. Cover and gallery both send
      `experienceId`, and the one it is already on is the only honest value —
      asking the operator to pick it again would be asking them to confirm a
      fact the response already carries.
    */
    coverOrGallery: attached && Boolean(item.listing?.experienceId),
    replace: ["changes_needed", "live", "failed"].includes(situation),
    // "anything except `withdrawn`", including a situation this build does not
    // recognise: taking something down is never the dangerous direction.
    takeDown: situation !== "withdrawn",
  };
}

/**
 * The reviewer's reason, worded as the reels page words it.
 *
 * `NOT_THIS_EXPERIENCE` becomes "not this experience" rather than a constant
 * shouted at somebody. The code is an open string on the wire, so anything
 * unrecognised is still shown: the reviewer wrote it about this clip, and a
 * reason we cannot pretty-print is worth more than no reason at all.
 */
export function declineLine(code: string | undefined): string | null {
  const raw = code?.trim();
  if (!raw) return null;
  return raw.replaceAll("_", " ").toLowerCase();
}

/**
 * The line a Replace earns while the old one is still up.
 *
 * Only on `live`: taking a clip down first leaves the listing with nothing on
 * it while the new one goes through review, and a listing with no footage
 * renders as a black card in the traveller app.
 */
export function replaceNote(situation: string | undefined): string | null {
  return situation === "live"
    ? "Keep this one up until the new one is live, then take this one down."
    : null;
}
