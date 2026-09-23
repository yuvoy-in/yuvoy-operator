import type { JoinState } from "./actions";

/**
 * What the code step can honestly show, decided in one place (yuvoy-api#227).
 *
 * `POST /join/{token}/code` used to answer `sent: true` for everybody, so this
 * step always drew a code box and "It lasts a few minutes" beneath it. For an
 * invitation made without an email address, while there is no phone sender,
 * nothing was on its way: the person waited for a message nothing carried.
 * The API now reads `sent` back from what it queued, and `note` says what to
 * do about it ("Ask whoever invited you to add you again with an email
 * address").
 *
 * So when nothing was sent the step says so and stops asking for a code. The
 * code still exists and would still work, but in production nobody can hold
 * it: it is never returned to the inviter. A development build is the one
 * place that does hold it (`devCode`), so the box stays there, which is also
 * what keeps the mocked flow testable end to end.
 */
export interface CodeStep {
  /** The sentence to lead with when no code was sent, or null. */
  notSent: string | null;
  /** Whether to draw the code box, and the button that sends it. */
  askForCode: boolean;
  /**
   * What the "this takes you off another business" panel says, or null when
   * it should not be drawn. Only while a code can still be typed: without
   * one nobody can accept, so there is nothing yet to agree to.
   */
  leavingText: string | null;
}

/** Said when the API sent `sent: false` without a `note`. */
export const NOT_SENT_FALLBACK =
  "We could not send your code. Ask whoever invited you to add you again with an email address.";

export function codeStep(state: JoinState, businessName?: string): CodeStep {
  const notSentAtAll = state.sent === false;
  const askForCode = !notSentAtAll || Boolean(state.devCode);

  const leaving = state.leavingBusiness;
  const joining =
    state.invited?.businessName ?? businessName ?? "this business";
  const leavingDefault = leaving
    ? `One number works with one business at a time. Joining ${joining} ends your access to ${leaving} straight away, including on any device already signed in.`
    : null;

  return {
    notSent: notSentAtAll ? state.note || NOT_SENT_FALLBACK : null,
    askForCode,
    leavingText:
      leaving && askForCode
        ? /*
            When nothing was sent, `note` carries the not-sent sentence as well
            ("both can be true at once, and the sentences then arrive together
            in this one field"). It is already on screen above, so the panel
            keeps its own words rather than repeating it.
          */
          notSentAtAll
          ? leavingDefault
          : (state.note ?? leavingDefault)
        : null,
  };
}
