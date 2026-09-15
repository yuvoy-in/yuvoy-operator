import { sentence } from "@/lib/format/sentence";
import type { Suspension } from "@/lib/account/standing";

/**
 * Why this business cannot trade, on every signed-in screen - yuvoy-operator#50.
 *
 * At the very top, above everything, because it changes what every other
 * control on the page means. An operator who taps Pause and reads "your role
 * cannot do this" has been told the wrong thing twice over: it is not their
 * role, and the reason is not on the screen they are looking at.
 *
 * ## The fields are rendered, never rewritten
 *
 * All three come from the API and each says something the portal cannot know.
 * `message` is the owner's sentence for the status, and the contract is
 * explicit that "every refused write answers with [it] too, so a banner and a
 * tapped button never disagree" - so a sentence of ours here would guarantee
 * they disagree. `adminMessage` is what a person at Yuvoy wrote to this
 * business, shown as plain text. `stillAllowed` is what keeps working, which
 * is the half that stops somebody assuming the season is over.
 *
 * Through `sentence()` for the reason every other API string is: it strips a
 * long dash the copy rule cannot reach from here. `adminMessage` is
 * deliberately NOT put through it: it is a person's own words to this
 * operator, and capitalising or punctuating them is editing somebody's
 * message.
 *
 * ## Why the reason is absent
 *
 * The recorded reason an admin wrote is not on the wire and is not invented
 * here. The contract says why: it "is written for our audit trail and can name
 * a third party."
 */
export function SuspensionBanner({
  suspension,
}: {
  suspension: NonNullable<Suspension> | null;
}) {
  if (!suspension) return null;

  const message = sentence(suspension.message ?? "");
  if (!message) return null;

  const admin = suspension.adminMessage?.trim();
  const stillAllowed = sentence(suspension.stillAllowed ?? "");

  return (
    <div
      role="alert"
      className="border-terra/40 bg-terra/10 text-paper border-b px-5 py-4 lg:px-8"
    >
      <p className="text-sm font-bold">{message}</p>
      {admin ? <p className="text-paper/80 mt-2 text-sm">{admin}</p> : null}
      {stillAllowed ? (
        <p className="text-paper/70 mt-2 text-sm">{stillAllowed}</p>
      ) : null}
    </div>
  );
}
