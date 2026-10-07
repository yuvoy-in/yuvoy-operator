import { beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorApiError } from "@/lib/api/errors";
import type { JoinState } from "./actions";

/*
  Accepting from the join link (yuvoy-operator#145). The route answers two
  409s and only one of them means "ask them first": `confirmation_required`.
  The other, `cannot_invite`, is a wrong or used-up code, and every 409 used
  to draw "This will take you off another business" for it.
*/

const post = vi.fn();

vi.mock("@/lib/api/server-client", () => ({
  operatorApi: () => ({ POST: post }),
}));
vi.mock("@/lib/auth/session-writes", () => ({ writeSessionToken: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const { acceptJoin } = await import("./actions");

const PREV: JoinState = {
  step: "code",
  phone: "+919000000104",
  invited: { businessName: "Reef Divers Havelock", role: "STAFF" },
};

function form(): FormData {
  const f = new FormData();
  f.set("code", "000000");
  return f;
}

function refuse(code: string, message: string, status = 409) {
  post.mockResolvedValue({
    data: undefined,
    error: new OperatorApiError({ code, message, status }),
  });
}

beforeEach(() => post.mockReset());

describe("a 409 on accepting", () => {
  it("asks about leaving only for confirmation_required", async () => {
    refuse(
      "confirmation_required",
      "accepting this removes you from the business you are in now. Send confirmLeaving to go ahead",
    );
    const next = await acceptJoin("jn_reefdivers", PREV, form());
    expect(next).toMatchObject({
      step: "code",
      leavingBusiness: "another business",
    });
    expect(next.message).toBeUndefined();
  });

  it("keeps a wrong or used-up code on the code step, in the API's sentence", async () => {
    refuse(
      "cannot_invite",
      "we could not accept that invitation. Check the code and try again",
    );
    const next = await acceptJoin("jn_reefdivers", PREV, form());
    expect(next).toEqual({
      ...PREV,
      message:
        "We could not accept that invitation. Check the code and try again.",
    });
    expect(next.leavingBusiness).toBeUndefined();
  });

  it("says its own sentence when the API gives none", async () => {
    refuse("conflict", "");
    const next = await acceptJoin("jn_reefdivers", PREV, form());
    expect(next.message).toBe("That did not work. Try the code again.");
    expect(next.leavingBusiness).toBeUndefined();
  });
});

describe("a right code no retry can use", () => {
  /*
    Both `403`s on accepting, documented with yuvoy-api#280: an offboarded
    business, and a number whose closed login is waiting to be erased. Each
    fell to "Try the code again", which would only spend another try on the
    same answer.
  */
  it("says the business is on hold, and who to call", async () => {
    refuse("account_not_active", "this business cannot be joined", 403);
    const next = await acceptJoin("jn_reefdivers", PREV, form());
    expect(next).toEqual({
      ...PREV,
      message:
        "This business account is on hold, so it cannot be signed into. Call us on +91 81216 57657.",
    });
  });

  it("says a closed login cannot join, and who to call", async () => {
    refuse(
      "account_deletion_pending",
      "Your account is being deleted, so you cannot sign in. If you did not mean to close it, contact support.",
      403,
    );
    const next = await acceptJoin("jn_reefdivers", PREV, form());
    expect(next.step).toBe("code");
    expect(next.message).toBe(
      "Your login was closed and is being deleted, so it cannot be signed into. If you did not mean to close it, call us on +91 81216 57657.",
    );
    expect(next.leavingBusiness).toBeUndefined();
  });
});
