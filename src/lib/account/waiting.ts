import {
  blockerAction,
  blockerText,
  splitByWaitingOn,
  type Blocker,
} from "./standing";

/**
 * What is waiting on the operator, each thing named and linked to where it is
 * fixed: yuvoy-operator#86 s9.
 *
 * "'2 things waiting on you' does not say what they are ... the one thing on
 * this screen that needs action is the one thing that stays vague. Name the two
 * things in the strip: 'Add your logo · Complete business details'."
 *
 * ## The same list the Business badge counts
 *
 * One item per blocker in `splitByWaitingOn(blocking).operator`, in its order,
 * and nothing else: the badge on the Business tab counts exactly that list
 * (owner ruling on #42, `NavBadges`), so a strip naming three things under a
 * badge saying two would teach somebody to ignore both.
 *
 * ## The words
 *
 * An action where there is one to take, in the words the Verification screen's
 * buttons use for it, so one thing has one name. A document is named from the
 * API's own sentence ("We still need your insurance certificate" becomes "Send
 * your insurance certificate"), because the blocker carries no document type of
 * its own. Anything this build cannot read is the API's sentence as it is: the
 * contract's rule for `label`, "render it for anything you do not recognise".
 */
export interface WaitingItem {
  text: string;
  href: string;
}

/** Where a blocker with no screen of its own is dealt with, and read in full. */
const VERIFICATION = "/account/verification";

export function waitingItems(blocking: readonly Blocker[]): WaitingItem[] {
  return splitByWaitingOn(blocking).operator.map((blocker) => ({
    text: itemText(blocker),
    href: blockerAction(blocker)?.href ?? VERIFICATION,
  }));
}

function itemText(blocker: Blocker): string {
  const label = (blocker.label ?? "").trim();
  switch (blocker.code) {
    case "BUSINESS_DETAILS_INCOMPLETE":
    case "LOGO_MISSING":
      return blockerAction(blocker)?.label ?? blockerText(blocker);
    case "CREDENTIAL_MISSING": {
      // yuvoy-api: "We still need your " + the document's name.
      const doc = /^we still need your (.+?)\.?$/i.exec(label)?.[1];
      return doc ? `Send your ${doc}` : blockerText(blocker);
    }
    case "CREDENTIAL_EXPIRED": {
      // yuvoy-api: the document's name + " has expired".
      const doc = /^(?:your )?(.+?) has expired\.?$/i.exec(label)?.[1];
      return doc ? `Send a new ${lowerFirst(doc)}` : blockerText(blocker);
    }
    case "CREDENTIAL_REJECTED": {
      // yuvoy-api: the document's name + " was not accepted".
      const doc = /^(?:your )?(.+?) was not accepted\.?$/i.exec(label)?.[1];
      return doc ? `Send a new ${lowerFirst(doc)}` : blockerText(blocker);
    }
    default:
      return blockerText(blocker);
  }
}

/** "Insurance certificate" → "insurance certificate"; "GST registration" stays. */
function lowerFirst(text: string): string {
  if (/^[A-Z]{2,}\b/.test(text)) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
}
