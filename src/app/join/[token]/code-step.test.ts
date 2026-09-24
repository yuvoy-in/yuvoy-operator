import { describe, expect, it } from "vitest";
import { NOT_SENT_FALLBACK, codeStep } from "./code-step";
import type { JoinState } from "./actions";

/*
  yuvoy-api#227: `POST /join/{token}/code` answered `sent: true` for everybody,
  so the join page asked for a code that nothing was carrying to an invitee
  with no email address. The API now reads `sent` back from what it queued.
*/

const NOT_SENT_NOTE =
  "We could not send your code. Ask whoever invited you to add you again with an email address, so we have somewhere to send it.";
const LEAVING_NOTE =
  "Accepting removes you from Havelock Water Sports. One number works with one business at a time.";

function state(over: Partial<JoinState>): JoinState {
  return {
    step: "code",
    phone: "+919000000104",
    invited: { businessName: "Reef Divers Havelock", role: "STAFF" },
    ...over,
  };
}

describe("the code step, when a code was sent", () => {
  it("asks for the code and says nothing about sending", () => {
    const step = codeStep(state({ sent: true }));
    expect(step).toEqual({
      notSent: null,
      askForCode: true,
      leavingText: null,
    });
  });

  it("reads an API older than 2afd7b4, which sent no `sent`, as sent", () => {
    expect(codeStep(state({})).askForCode).toBe(true);
    expect(codeStep(state({})).notSent).toBeNull();
  });

  it("puts the API's leaving sentence in the leaving panel", () => {
    const step = codeStep(
      state({
        sent: true,
        leavingBusiness: "Havelock Water Sports",
        note: LEAVING_NOTE,
      }),
    );
    expect(step.leavingText).toBe(LEAVING_NOTE);
    expect(step.askForCode).toBe(true);
  });

  it("writes the leaving sentence itself when the API sent none", () => {
    const step = codeStep(
      state({ sent: true, leavingBusiness: "Havelock Water Sports" }),
    );
    expect(step.leavingText).toBe(
      "One number works with one business at a time. Joining Reef Divers Havelock ends your access to Havelock Water Sports straight away, including on any device already signed in.",
    );
  });
});

describe("the code step, when nothing was sent", () => {
  it("says so in the API's words and stops asking for a code", () => {
    const step = codeStep(state({ sent: false, note: NOT_SENT_NOTE }));
    expect(step.notSent).toBe(NOT_SENT_NOTE);
    expect(step.askForCode).toBe(false);
    expect(step.leavingText).toBeNull();
  });

  it("still says so when the API sent no note", () => {
    const step = codeStep(state({ sent: false }));
    expect(step.notSent).toBe(NOT_SENT_FALLBACK);
    expect(step.askForCode).toBe(false);
  });

  it("does not ask anybody to agree to leave a business they cannot join", () => {
    /*
      Both sentences arrive together in `note` when both are true. Without a
      code nobody can accept, so there is nothing to agree to yet, and the
      whole note is said once, above.
    */
    const step = codeStep(
      state({
        sent: false,
        leavingBusiness: "Havelock Water Sports",
        note: `${NOT_SENT_NOTE} ${LEAVING_NOTE}`,
      }),
    );
    expect(step.notSent).toBe(`${NOT_SENT_NOTE} ${LEAVING_NOTE}`);
    expect(step.leavingText).toBeNull();
    expect(step.askForCode).toBe(false);
  });

  it("keeps the code box in a development build, which does hold the code", () => {
    const step = codeStep(
      state({
        sent: false,
        note: NOT_SENT_NOTE,
        devCode: "123456",
        leavingBusiness: "Havelock Water Sports",
      }),
    );
    expect(step.askForCode).toBe(true);
    expect(step.notSent).toBe(NOT_SENT_NOTE);
    // The not-sent sentence is already on screen, so the panel keeps its own.
    expect(step.leavingText).toMatch(/^One number works with one business/);
  });
});
