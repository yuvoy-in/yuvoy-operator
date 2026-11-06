import type { components } from "@/lib/api/schema.gen";

/**
 * The words of a listing claim (yuvoy-operator#388, the web half of
 * yuvoy-mobile#388). Copied from the phone's
 * `packages/core/src/operator/listing-claims.ts` word for word, so the claim
 * reads the same in Yuvoy Host and on operators.yuvoy.in. The ones the issue
 * marks proposed wait on Sai Teja's wording check there; change both together.
 */

export type ClaimProofMethod = components["schemas"]["ListingClaimProofMethod"];

/** The four ways to show the listing is the business's own, in the order offered. */
export const PROOF_OPTIONS: readonly {
  method: ClaimProofMethod;
  title: string;
  body: string;
}[] = [
  {
    method: "email_domain",
    title: "Get a code at your business email",
    body: "We send a six-digit code to an address at your website.",
  },
  {
    method: "public_page_code",
    title: "Post a code on your own page",
    body: "We give you a code to put on your website or your business's social media page.",
  },
  {
    method: "call_to_published_number",
    title: "We call your business",
    body: "We call the number on your own public page.",
  },
  {
    method: "documents",
    title: "Send us your papers",
    body: "We ask you for your business registration papers.",
  },
];

export const CLAIM_TITLE = "Claim a listing";
export const CLAIM_LOADING = "Reading the listing";

/** The API's own sentence for `email_domain` on a listing with no website, said before any tap. */
export const NO_WEBSITE_LINE =
  "This listing has no website, so prove it another way.";

/** Signed out: the listing's name needs a session, so the door names none. */
export const CLAIM_SIGNED_OUT_LINE = "Sign up or sign in to claim this listing";

/** The preview's `claimable` is false: a claim waits on it, or a business holds it. */
export const CLAIM_NOT_OPEN_LINE =
  "A claim on this listing is already with our team, or a business holds it already.";

/** A removed or unknown listing, when the API sends no sentence of its own. */
export const NO_LISTING_LINE = "There is no listing to claim here.";

export const ASK_TO_CLAIM = "Ask to claim";
export const COPY_CODE = "Copy code";
export const COPIED = "Copied";
export const SEND_CODE = "Send code";
export const CHECK_CODE = "Check code";
export const CODE_FIELD_LABEL = "Enter the six-digit code";
export const EMAIL_SENT_LINE =
  "If that address is at your website, a code is on its way. It can take a few minutes.";
export const EMAIL_CHECKED_LINE =
  "Email checked. A person at Yuvoy decides next.";
export const CLAIM_DECIDE_LINE = "We email the owner when we decide.";
export const CLAIMS_HEADING = "Listing claims";
export const SEE_CLAIMS_LINK = "See your claims under Verification";
export const REMOVED_LISTING = "A removed listing";

/** The web's own line: a browser can refuse the clipboard, and the code is still on screen. */
export const COPY_FAILED = "Could not copy. The code is above.";

/** Under the web claim, for a phone that would rather use the app. */
export const STORE_LINE = "You can also claim in our app, Yuvoy Host.";

/** The phone's lead for a write that went quiet: it may have gone through. */
export const STALLED_LEAD =
  "The connection dropped, so we cannot tell whether that went through.";

/** The code the email step takes: six digits. */
export const CLAIM_CODE = /^[0-9]{6}$/;
